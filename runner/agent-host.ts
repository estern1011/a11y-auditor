import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { query as defaultQuery } from "@anthropic-ai/claude-agent-sdk";
import type {
  Options,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type { Finding, PhaseId, RunnerState, TranscriptLine } from "./state.ts";
import { loadAgentFile } from "./agent-frontmatter.ts";
import { AGENT_SCHEMAS } from "./schemas/index.ts";
import { appendEvent } from "./tools/run-dir.ts";
import { now, serialize, type RunnerEvent } from "./events.ts";

export type AgentId =
  | "auth"
  | "baseline-collector"
  | "keyboard-walker"
  | "visual-cross-referencer";

export interface RunAgentInput {
  agentId: AgentId;
  state: RunnerState;
}

export interface AgentSignals {
  hasInteractive: boolean;
  treeEmpty: boolean;
  needsAuth: boolean;
}

export interface AgentOutput {
  findings: Finding[];
  transcript: TranscriptLine[];
  signals: AgentSignals;
  phaseOk: boolean;
  error?: string;
}

export type QueryFactory = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => Query;

export interface RunAgentDeps {
  /**
   * Factory that returns an Agent SDK `Query` given prompt + options. Exists
   * so runner/agent-host.test.ts can inject a stub query that yields canned
   * SDKMessages instead of spawning the real Claude Code subprocess. Same
   * dep-injection pattern we use for `spawnDaemon` in runner/tools/driver.ts.
   */
  queryFactory?: QueryFactory;
  /**
   * Clock injection for deterministic timestamps in tests.
   */
  now?: () => number;
}

const DEFAULT_SIGNALS: AgentSignals = {
  hasInteractive: true,
  treeEmpty: false,
  needsAuth: false,
};

// Intentionally no hard-coded default model. `@anthropic-ai/claude-agent-sdk`
// pinned at 0.1.77 (see bun.lock) was shipped before Opus 4.7, so a
// default of "claude-opus-4-7" would break every agent run that doesn't
// declare its own `model:` override. Omitting `Options.model` lets the SDK
// fall back to whatever default the installed Claude Code binary ships with,
// which is the only choice we can guarantee is valid against the pinned SDK.
// Agent authors who want a specific model still declare it in their .md
// frontmatter — the runner forwards that verbatim.
const AGENT_TIMEOUT_MS = 5 * 60 * 1000;

// Absolute path to the `bun drivers/<sr>/driver.ts` script for each screen
// reader, so the prompt we hand the agent matches what the orchestrator
// documentation in .claude/agents/*.md expects ("sr-driver path").
const RUNNER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(RUNNER_DIR, "..");
const DRIVER_SCRIPTS: Record<RunnerState["sr"], string> = {
  voiceover: resolve(REPO_ROOT, "drivers", "voiceover", "driver.ts"),
  orca: resolve(REPO_ROOT, "drivers", "orca", "driver.ts"),
};

const AGENT_TO_PHASE: Record<AgentId, PhaseId> = {
  "baseline-collector": "baseline",
  "keyboard-walker": "keyboard",
  "visual-cross-referencer": "visual",
  auth: "auth",
};

export function agentPhase(agentId: AgentId): PhaseId {
  return AGENT_TO_PHASE[agentId];
}

// Loads `.claude/agents/<id>.md`, configures an Agent SDK session with its
// frontmatter (tools + model) and body (system prompt), drives the session to
// completion while narrating tool calls into the transcript + an
// `agent-<id>.ndjson` file, and validates the structured output against the
// matching Zod schema before returning.
//
// If the schema is missing from runner/schemas/index.ts (keyboard/visual/auth
// at this slice), we short-circuit to defaults — the conditional edges still
// route end-to-end, but findings and real signals land in a later slice. See
// docs/web-dashboard-plan.md ("Agent output → state contract" risk).
export async function runAgent(
  input: RunAgentInput,
  deps: RunAgentDeps = {},
): Promise<AgentOutput> {
  const { agentId, state } = input;
  const phase = agentPhase(agentId);

  const schemaEntry = AGENT_SCHEMAS[agentId];
  if (!schemaEntry) {
    // Scaffold path for agents whose schema / prompt wiring lands later.
    return {
      findings: [],
      transcript: [],
      signals: { ...DEFAULT_SIGNALS },
      phaseOk: true,
    };
  }

  // Intentionally no env-var pre-check here. The Agent SDK spawns Claude
  // Code, which authenticates via any of: `ANTHROPIC_API_KEY`, a cached
  // OAuth / subscription login under `~/.claude/`, `CLAUDE_CODE_OAUTH_TOKEN`,
  // Vertex, or Bedrock. Checking only `ANTHROPIC_API_KEY` would reject a
  // perfectly valid subscription-logged-in host. The SDK already surfaces
  // its own auth error (which is richer than anything we could produce from
  // env inspection) and that error is now propagated to runner/index.ts
  // thanks to the P1 fix on baselineNode, so a missing-auth run ends with
  // `done ok:false` rather than silent empty findings.

  const clock = deps.now ?? now;
  const startedAt = clock();
  const parsed = await loadAgentFile(agentId);
  const model = parsed.frontmatter.model;

  const logPath = resolve(state.runDir, `agent-${agentId}.ndjson`);
  await mkdir(dirname(logPath), { recursive: true });

  const emitEvent = async (ev: RunnerEvent) => {
    try {
      await appendEvent(state.runDir, serialize(ev));
    } catch {
      // events.ndjson unwritable — we already log to agent-<id>.ndjson, which
      // is enough for a post-mortem. Don't let a disk-full event kill the run.
    }
  };

  await emitEvent({
    k: "agent.start",
    t: startedAt,
    node: phase,
    agentId,
    model: model ?? "(sdk-default)",
  });

  const userPrompt = buildUserPrompt({ agentId, state });
  const queryFactory = deps.queryFactory ?? defaultQuery;

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), AGENT_TIMEOUT_MS);

  // Single failure funnel. Every throw path inside the try records an
  // `agent.done` event with ok:false so event consumers always see a terminal
  // lifecycle signal for this agent execution — even when structured output
  // fails schema validation or the SDK subprocess never produces a `result`
  // message. Previously only the outer-iteration catch did this, so a
  // malformed-output run left `events.ndjson` with `agent.start` and no close.
  const transcript: TranscriptLine[] = [];
  try {
    // Honor the frontmatter's tool list as a *hard* restriction, not just
    // auto-approval. Per the SDK docs, `allowedTools` only suppresses the
    // permission prompt for listed tools — the model can still request
    // unlisted tools and either execute them (with a permission fallback) or
    // cause the session to hang on a prompt in headless runs. `tools:
    // string[]` is the actual base-set restriction. We pass both so:
    //   - the frontmatter list is the only set of built-in tools the model
    //     can see (`tools`), and
    //   - those tools run without interactive approval (`allowedTools`),
    //     which is what headless sprite runs need.
    // If an agent file omits a `tools:` line, default to the documented
    // Claude Code preset rather than an empty allowlist (which would disable
    // every built-in tool and make the agent useless).
    const allowlist = parsed.frontmatter.tools;
    const baseTools: Options["tools"] = allowlist
      ? allowlist
      : { type: "preset", preset: "claude_code" };

    const result = await driveAgentSession({
      queryFactory,
      prompt: userPrompt,
      options: {
        abortController,
        // Agents authored in `.claude/agents/*.md` invoke repo-relative
        // commands like `bun collect.ts ...` in their procedure sections.
        // Pinning cwd to the repo root makes agent runs deterministic even
        // when the runner is invoked from a different working directory
        // (the rest of the runner is already cwd-independent via
        // `fileURLToPath`; this closes the last gap for tool calls).
        cwd: REPO_ROOT,
        model,
        systemPrompt: parsed.systemPrompt,
        tools: baseTools,
        allowedTools: allowlist,
        outputFormat: {
          type: "json_schema",
          schema: schemaEntry.jsonSchema,
        },
        env: { ...process.env },
      } as Options,
      logPath,
      transcript,
      phase,
      clock,
    });

    if (!result) {
      throw new Error(
        `runAgent(${agentId}): Agent SDK query ended without a 'result' message`,
      );
    }

    // Budget accounting — surfaced as an event line so the dashboard can show
    // per-agent spend. See plan "Cost envelope" open question; this is the
    // soft accounting step before we wire a hard cap. Emit for every terminal
    // result (success or error) so a failed agent still contributes to the
    // per-run spend total.
    const usd = result.total_cost_usd ?? 0;
    const tokens =
      (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0);
    await emitEvent({ k: "budget", t: clock(), node: phase, agentId, usd, tokens });

    if (result.subtype !== "success") {
      const errText =
        "errors" in result && Array.isArray(result.errors) && result.errors.length > 0
          ? result.errors.join("; ")
          : `Agent SDK returned non-success subtype '${result.subtype}'`;
      throw new Error(`runAgent(${agentId}) failed: ${errText}`);
    }

    // Validate the structured output against the Zod schema. Falls back to
    // parsing `result.result` as JSON if the SDK didn't populate
    // `structured_output` — some transport paths don't.
    const candidate = result.structured_output ?? tryParseJson(result.result);
    if (candidate === undefined) {
      const preview =
        typeof result.result === "string" ? result.result.slice(0, 400) : "";
      throw new Error(
        `runAgent(${agentId}): no structured output from agent. result.result preview: ${preview}`,
      );
    }

    const parseResult = schemaEntry.zod.safeParse(candidate);
    if (!parseResult.success) {
      const payload = JSON.stringify(candidate).slice(0, 2000);
      throw new Error(
        `runAgent(${agentId}): structured output failed schema validation — ${parseResult.error.message}\nPayload: ${payload}`,
      );
    }

    const validated = parseResult.data as {
      findings: Finding[];
      signals: AgentSignals;
    };

    // Stamp `sources` on any finding that didn't declare one so the downstream
    // reducer can still attribute the evidence channel.
    const findings = validated.findings.map((f) => ({
      ...f,
      sources: f.sources && f.sources.length > 0 ? f.sources : ["axe" as const],
    }));

    await emitEvent({
      k: "agent.done",
      t: clock(),
      node: phase,
      agentId,
      ok: true,
      findings: findings.length,
      durationMs: clock() - startedAt,
    });

    return {
      findings,
      transcript,
      signals: validated.signals,
      phaseOk: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await emitEvent({
      k: "agent.done",
      t: clock(),
      node: phase,
      agentId,
      ok: false,
      error: message,
      durationMs: clock() - startedAt,
    });
    throw err instanceof Error ? err : new Error(message);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

interface DriveAgentSessionInput {
  queryFactory: QueryFactory;
  prompt: string;
  options: Options;
  logPath: string;
  transcript: TranscriptLine[];
  phase: PhaseId;
  clock: () => number;
}

// Runs the Agent SDK query to completion, logging every message and narrating
// assistant text / tool uses into the transcript. Returns the terminal
// `result` message (or undefined if the query iterator closed without one).
async function driveAgentSession(
  input: DriveAgentSessionInput,
): Promise<SDKResultMessage | undefined> {
  const q = input.queryFactory({
    prompt: input.prompt,
    options: input.options,
  });
  let result: SDKResultMessage | undefined;
  for await (const msg of q) {
    await appendFile(input.logPath, JSON.stringify(msg) + "\n", "utf8");
    appendTranscriptForMessage(msg, input.transcript, input.phase, input.clock);
    if (msg.type === "result") {
      result = msg;
    }
  }
  return result;
}

function tryParseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Some prompts (or models disregarding outputFormat) return the JSON fenced
  // in ```json blocks. Strip the fence before parsing.
  const stripped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}

function appendTranscriptForMessage(
  msg: SDKMessage,
  out: TranscriptLine[],
  phase: PhaseId,
  clock: () => number,
): void {
  // Narrate Agent SDK messages as transcript lines so the dashboard timeline
  // has something to render even before a dedicated agent.chunk stream lands.
  // Assistant text → channel:agent. Tool uses → channel:tool (summarized).
  if (msg.type === "assistant") {
    const m = msg.message;
    if (m && Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === "text" && typeof block.text === "string") {
          const text = block.text.trim();
          if (text) {
            out.push({ t: clock(), phase, channel: "agent", text });
          }
        } else if (block.type === "tool_use") {
          const summary = summarizeToolUse(
            block.name,
            (block as { input?: unknown }).input,
          );
          out.push({ t: clock(), phase, channel: "tool", text: summary });
        }
      }
    }
  }
}

function summarizeToolUse(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return name;
  const obj = input as Record<string, unknown>;
  // Common Claude Code tool shapes — keep the summary to one short line.
  if (typeof obj.command === "string") {
    return `${name}: ${truncate(obj.command, 160)}`;
  }
  if (typeof obj.file_path === "string") {
    return `${name}: ${obj.file_path}`;
  }
  if (typeof obj.pattern === "string") {
    return `${name}: ${obj.pattern}`;
  }
  return name;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

interface UserPromptInput {
  agentId: AgentId;
  state: RunnerState;
}

export function buildUserPrompt({ agentId, state }: UserPromptInput): string {
  const driverScript = DRIVER_SCRIPTS[state.sr];

  // Hands the agent the same fields today's orchestrator passes verbatim to
  // the sub-agent prompt: url, sr-driver path, CDP port, HTTP (driver) port.
  // The "return structured JSON that matches the outputFormat" instruction is
  // belt-and-braces: the SDK's outputFormat already constrains the shape, but
  // a prose reminder helps older models route the response through the right
  // structured-output path rather than emitting a markdown digest.
  const lines = [
    `You are invoked as the '${agentId}' sub-agent of the a11y-auditor runner.`,
    "",
    "Inputs:",
    `- url: ${state.url}`,
    `- sr-driver: ${driverScript}`,
    `- cdp-port: ${state.cdpPort}`,
    `- http-port: ${state.driverPort}`,
    "",
    "Follow your agent definition to produce the digest it describes. In",
    "addition, return your final answer as JSON matching the provided",
    "output schema. Every axe violation, resolved-incomplete 'fail', and any",
    "URL drift you would have surfaced in the markdown digest must also be",
    "represented as a `findings[]` entry (with a WCAG `criterion` like",
    "'1.1.1' or '2.4.1'). `signals.hasInteractive` is true when the page has",
    "any tabbable controls; `signals.treeEmpty` is true when the a11y tree is",
    "empty/unreachable; `signals.needsAuth` is true when the baseline shows",
    "the page is behind a login gate.",
  ];
  return lines.join("\n");
}
