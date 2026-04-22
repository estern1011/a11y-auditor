import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { query as defaultQuery } from "@anthropic-ai/claude-agent-sdk";
import type {
  Options,
  Query,
  SDKMessage,
  SDKResultMessage,
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
  prompt: string | AsyncIterable<unknown>;
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

const DEFAULT_MODEL = "claude-opus-4-7";
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

  if (!process.env.ANTHROPIC_API_KEY && agentId !== "auth") {
    // Fail loud rather than silently degrading to defaults — that's the bug
    // this slice was written to fix.
    throw new Error(
      `runAgent(${agentId}): ANTHROPIC_API_KEY is not set. The Agent SDK cannot run without it.`,
    );
  }

  const clock = deps.now ?? now;
  const startedAt = clock();
  const parsed = await loadAgentFile(agentId);
  const model = parsed.frontmatter.model ?? DEFAULT_MODEL;

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
    model,
  });

  const userPrompt = buildUserPrompt({ agentId, state });
  const queryFactory = deps.queryFactory ?? defaultQuery;

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), AGENT_TIMEOUT_MS);

  let result: SDKResultMessage | undefined;
  const transcript: TranscriptLine[] = [];

  try {
    const q = queryFactory({
      prompt: userPrompt,
      options: {
        abortController,
        model,
        systemPrompt: parsed.systemPrompt,
        allowedTools: parsed.frontmatter.tools,
        outputFormat: {
          type: "json_schema",
          schema: schemaEntry.jsonSchema,
        },
        env: { ...process.env },
      } as Options,
    });

    for await (const msg of q) {
      await appendFile(logPath, JSON.stringify(msg) + "\n", "utf8");
      appendTranscriptForMessage(msg, transcript, phase, clock);
      if (msg.type === "result") {
        result = msg;
      }
    }
  } catch (err) {
    clearTimeout(timeoutHandle);
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
    throw new Error(`runAgent(${agentId}) threw: ${message}`, { cause: err });
  }
  clearTimeout(timeoutHandle);

  if (!result) {
    const msg = `runAgent(${agentId}): Agent SDK query ended without a 'result' message`;
    await emitEvent({
      k: "agent.done",
      t: clock(),
      node: phase,
      agentId,
      ok: false,
      error: msg,
      durationMs: clock() - startedAt,
    });
    throw new Error(msg);
  }

  // Budget accounting — surfaced as an event line so the dashboard can show
  // per-agent spend. See plan "Cost envelope" open question; this is the soft
  // accounting step before we wire a hard cap.
  if (result.subtype === "success") {
    const usd = result.total_cost_usd ?? 0;
    const tokens =
      (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0);
    await emitEvent({ k: "budget", t: clock(), node: phase, agentId, usd, tokens });
  }

  if (result.subtype !== "success") {
    const errText =
      "errors" in result && Array.isArray(result.errors) && result.errors.length > 0
        ? result.errors.join("; ")
        : `Agent SDK returned non-success subtype '${result.subtype}'`;
    await emitEvent({
      k: "agent.done",
      t: clock(),
      node: phase,
      agentId,
      ok: false,
      error: errText,
      durationMs: clock() - startedAt,
    });
    throw new Error(`runAgent(${agentId}) failed: ${errText}`);
  }

  // Validate the structured output against the Zod schema. Falls back to
  // parsing `result.result` as JSON if the SDK didn't populate
  // `structured_output` — some transport paths don't.
  const candidate = result.structured_output ?? tryParseJson(result.result);
  if (candidate === undefined) {
    const preview = typeof result.result === "string" ? result.result.slice(0, 400) : "";
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
