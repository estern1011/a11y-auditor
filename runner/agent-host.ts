import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { query as defaultQuery } from "@anthropic-ai/claude-agent-sdk";
import type {
  Options,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { parseAgentFrontmatter, type AgentFrontmatter } from "./agents/frontmatter.ts";
import { serialize, now, type RunnerEvent } from "./events.ts";
import { agentSchemas, type AgentOutputParsed, type SchemaAgentId } from "./schemas/index.ts";
import type { Finding, PhaseId, RunnerState, TranscriptLine } from "./state.ts";

export type AgentId = SchemaAgentId;

export interface RunAgentInput {
  agentId: AgentId;
  state: RunnerState;
}

export interface AgentSignals {
  hasInteractive: boolean;
  treeEmpty: boolean;
  needsAuth: boolean;
}

export interface AgentUsage {
  tokens: number;
  costUsd: number;
}

export interface AgentOutput {
  findings: Finding[];
  transcript: TranscriptLine[];
  signals: AgentSignals;
  usage: AgentUsage;
}

// Dependency-inject the SDK query factory so tests can drive the message loop
// without network / ANTHROPIC_API_KEY. Production always uses defaultQuery.
export type QueryFactory = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => Query;

export interface RunAgentDeps {
  /** Defaults to @anthropic-ai/claude-agent-sdk's `query`. */
  query?: QueryFactory;
  /** Override the agents directory (primarily for tests). Defaults to `.claude/agents`. */
  agentsDir?: string;
  /** Optional event sink. When absent events are written to events.ndjson via appendEvent. */
  emit?: (ev: RunnerEvent) => Promise<void> | void;
  /** Override env for ANTHROPIC_API_KEY lookup (primarily for tests). */
  env?: Record<string, string | undefined>;
  /** Override clock for deterministic tests. */
  now?: () => number;
  /** Override the 5-minute total budget (ms). */
  timeoutMs?: number;
}

const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const RUNNER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(RUNNER_DIR, "..");
const DEFAULT_AGENTS_DIR = resolve(REPO_ROOT, ".claude", "agents");

const DRIVER_SCRIPTS: Record<"voiceover" | "orca", string> = {
  voiceover: resolve(REPO_ROOT, "drivers", "voiceover", "driver.ts"),
  orca: resolve(REPO_ROOT, "drivers", "orca", "driver.ts"),
};

const PHASE_BY_AGENT: Record<AgentId, PhaseId> = {
  auth: "auth",
  "baseline-collector": "baseline",
  "keyboard-walker": "keyboard",
  "visual-cross-referencer": "visual",
};

// Loads `.claude/agents/<id>.md`, uses its frontmatter (tool allowlist + model)
// and body (system prompt) to configure an Agent SDK session, awaits it to
// completion, parses the structured output against a Zod schema, and returns
// findings + transcript + signals that feed conditional edges.
export async function runAgent(
  input: RunAgentInput,
  deps: RunAgentDeps = {},
): Promise<AgentOutput> {
  const env = deps.env ?? process.env;
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey && input.agentId !== "auth") {
    throw new Error(
      `runAgent: ANTHROPIC_API_KEY missing from env — required for agent '${input.agentId}'. ` +
        "Set it in the server/runner's environment or in ~/.claude/settings.local.json.",
    );
  }

  const clock = deps.now ?? now;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const phase = PHASE_BY_AGENT[input.agentId];
  const agentsDir = deps.agentsDir ?? DEFAULT_AGENTS_DIR;
  const agentPath = join(agentsDir, `${input.agentId}.md`);

  const raw = await readFile(agentPath, "utf8");
  const fm = parseAgentFrontmatter(raw);
  const model = fm.model ?? DEFAULT_MODEL;

  const schema = agentSchemas[input.agentId];

  const userPrompt = buildUserPrompt(input.state, input.agentId, fm);
  const emit = buildEmitter(input.state.runDir, deps.emit);

  const ndjsonPath = join(input.state.runDir, `agent-${input.agentId}.ndjson`);
  await mkdir(dirname(ndjsonPath), { recursive: true });
  // Truncate per-agent NDJSON on every session start. run-dir.ts's
  // resetRunDir() scrubs events.ndjson / findings.json / etc. on rerun, but
  // the per-agent logs are created inside runAgent so they need their own
  // clean-slate step. Without this a retry with the same --run-id would
  // interleave old and new sessions in one log — bad for debugging and (once
  // the auth node lands) worse for leaking prior tool inputs into later runs.
  await writeFile(ndjsonPath, "", "utf8");

  await emit({
    k: "agent.start",
    t: clock(),
    node: phase,
    agentId: input.agentId,
    model,
  });

  const options = buildOptions(fm, model, apiKey);
  const queryFn: QueryFactory = deps.query ?? defaultQuery;

  let result: SDKResultMessage | undefined;
  const startedAt = Date.now();
  const q = queryFn({ prompt: userPrompt, options });
  const timeoutHandle = setTimeout(() => {
    // Calling interrupt() on the Query stops the in-flight turn; the message
    // loop then drains a `result` with an error subtype that we surface below.
    q.interrupt().catch(() => undefined);
  }, timeoutMs);

  try {
    for await (const msg of q) {
      await appendNdjson(ndjsonPath, msg);
      await relayChunk(msg, phase, emit, clock);
      if (msg.type === "result") {
        result = msg;
        break;
      }
    }
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!result) {
    const elapsed = Date.now() - startedAt;
    const hint = elapsed >= timeoutMs ? ` (timeout after ${String(timeoutMs)}ms)` : "";
    throw new Error(`runAgent[${input.agentId}]: session ended without a result message${hint}`);
  }

  if (result.subtype !== "success") {
    const errs = result.errors.join("; ") || result.subtype;
    await emit({
      k: "agent.done",
      t: clock(),
      node: phase,
      agentId: input.agentId,
      ok: false,
      error: errs,
    });
    throw new Error(`runAgent[${input.agentId}]: agent failed (${result.subtype}): ${errs}`);
  }

  const payload = extractStructuredPayload(result);
  const parsed = safeParseOrThrow(schema, payload, input.agentId);

  const usage: AgentUsage = {
    tokens:
      Number(result.usage.input_tokens ?? 0) +
      Number(result.usage.output_tokens ?? 0) +
      Number(result.usage.cache_read_input_tokens ?? 0) +
      Number(result.usage.cache_creation_input_tokens ?? 0),
    costUsd: result.total_cost_usd,
  };

  await emit({
    k: "budget",
    t: clock(),
    node: phase,
    agentId: input.agentId,
    usd: usage.costUsd,
    tokens: usage.tokens,
  });
  await emit({
    k: "agent.done",
    t: clock(),
    node: phase,
    agentId: input.agentId,
    ok: true,
  });

  return {
    findings: parsed.findings,
    transcript: parsed.transcript,
    signals: parsed.signals,
    usage,
  };
}

function buildUserPrompt(state: RunnerState, agentId: AgentId, fm: AgentFrontmatter): string {
  const driverScript = DRIVER_SCRIPTS[state.sr];
  // The prompt mirrors the inputs today's Claude-Code orchestrator passes
  // verbatim (url, sr-driver, cdp-port, http-port) plus an explicit instruction
  // that the final message must be the JSON object we validate — the .md body
  // itself still describes a markdown digest, so without this override the
  // agent would return prose and fail the Zod parse.
  const lines = [
    `You are the '${agentId}' sub-agent. The orchestrator's inputs:`,
    `  - url: ${state.url}`,
    `  - sr-driver: ${driverScript}`,
    `  - cdp-port: ${String(state.cdpPort)}`,
    `  - http-port: ${String(state.driverPort)}`,
    `  - run-dir: ${state.runDir}`,
    "",
    "Follow the procedure in your system prompt, but override its 'Output'",
    "section: your FINAL assistant message must be a single JSON object —",
    "no prose, no markdown fences — matching this shape:",
    "",
    "{",
    '  "findings": [ { "id", "criterion", "severity": "critical|serious|moderate|minor",',
    '    "title", "detail?", "selector?", "screenshot?", "markers?", "sources?" } ],',
    '  "transcript": [ { "t": <unix-ms>, "phase": "baseline|keyboard|visual|...",',
    '    "channel": "sr|key|tool|agent|system", "text": "..." } ],',
    '  "signals": { "hasInteractive": bool, "treeEmpty": bool, "needsAuth": bool }',
    "}",
    "",
    "`findings[].criterion` must be a WCAG SC id like '1.1.1'. `severity` must be",
    "one of the four impact levels above — not 'info' or 'note'. Missing fields",
    "fail validation loudly; prefer empty arrays + sane defaults over fabricated",
    "data.",
  ];
  void fm;
  return lines.join("\n");
}

function buildOptions(fm: AgentFrontmatter, model: string, apiKey: string | undefined): Options {
  // Always pass an explicit `tools` array — even when frontmatter omits
  // `tools:` and fm.tools is `[]`. The SDK treats `tools: []` as "disable all
  // built-in tools" (coreTypes.d.ts: `[] (empty array) - Disable all built-in
  // tools`). Dropping the field would instead let the SDK fall back to its
  // default full toolset, which combined with `permissionMode:
  // "bypassPermissions"` below would silently grant broad tool access when a
  // .md file simply forgot the `tools:` line. Default-deny is the safer
  // baseline.
  const tools = fm.tools;
  const options: Options = {
    model,
    systemPrompt: fm.systemPrompt,
    // Non-interactive automation — pre-approve the declared tool set and don't
    // ask the user. We keep the tool surface restricted to what the frontmatter
    // declared so an agent can't reach for Bash / Edit if the .md didn't grant
    // it. `allowedTools` matches `tools` so every declared tool is auto-allowed
    // and nothing else exists in the session.
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools,
    allowedTools: tools,
    // Route ANTHROPIC_API_KEY explicitly so the Claude Code child process picks
    // it up regardless of the caller's env propagation.
    ...(apiKey ? { env: { ...process.env, ANTHROPIC_API_KEY: apiKey } } : {}),
    // Budget cap is enforced at the runner level via AbortController/timeout;
    // per-run token cap belongs to the cost-envelope work in the plan's Open
    // Questions.
  };
  return options;
}

async function appendNdjson(path: string, value: unknown): Promise<void> {
  await appendFile(path, JSON.stringify(value) + "\n", "utf8");
}

async function relayChunk(
  msg: SDKMessage,
  phase: PhaseId,
  emit: (ev: RunnerEvent) => Promise<void>,
  clock: () => number,
): Promise<void> {
  // Map the SDK message stream onto our stable UI event schema. We only relay
  // shapes the UI can render — partial stream events are filtered out because
  // their shape is SDK-internal and noisy.
  if (msg.type === "assistant") {
    const text = flattenAssistantText(msg);
    if (text) await emit({ k: "agent.chunk", t: clock(), node: phase, channel: "agent", text });
    const tools = flattenToolCalls(msg);
    for (const t of tools) {
      await emit({ k: "agent.chunk", t: clock(), node: phase, channel: "tool", text: t });
    }
  }
}

function flattenAssistantText(msg: { message: { content: unknown } }): string {
  const content = msg.message.content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      "type" in block &&
      (block as { type: unknown }).type === "text"
    ) {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

function flattenToolCalls(msg: { message: { content: unknown } }): string[] {
  const content = msg.message.content;
  if (!Array.isArray(content)) return [];
  const calls: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      "type" in block &&
      (block as { type: unknown }).type === "tool_use"
    ) {
      const b = block as { name?: unknown; input?: unknown };
      const name = typeof b.name === "string" ? b.name : "tool";
      calls.push(`${name}(${safeStringify(b.input)})`);
    }
  }
  return calls;
}

function safeStringify(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 500 ? `${s.slice(0, 500)}…` : s;
  } catch {
    return "<unserializable>";
  }
}

function extractStructuredPayload(result: SDKResultMessage & { subtype: "success" }): unknown {
  // Prefer the SDK's native structured_output (populated when outputFormat is
  // set). If the caller didn't set outputFormat (we currently don't — we let
  // the agent produce raw JSON in the result string so the existing agent
  // prompts don't need JSON-schema rewrites), fall back to parsing the result
  // string as JSON.
  if (result.structured_output !== undefined) return result.structured_output;
  const text = result.result.trim();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `runAgent: agent returned non-JSON final message. Raw payload:\n${text}\n---\n` +
        `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

function safeParseOrThrow(
  schema: z.ZodTypeAny,
  payload: unknown,
  agentId: AgentId,
): AgentOutputParsed {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    // Stringify the offending payload inline so a bad run is diagnosable from
    // the single error message — the plan's "Agent output → state contract"
    // risk wants loud, not silent defaults.
    const payloadJson = (() => {
      try {
        return JSON.stringify(payload, null, 2);
      } catch {
        return String(payload);
      }
    })();
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(
      `runAgent[${agentId}]: Zod validation failed. Issues: ${issues}\nOffending payload:\n${payloadJson}`,
    );
  }
  return parsed.data as AgentOutputParsed;
}

function buildEmitter(
  runDir: string,
  emit?: RunAgentDeps["emit"],
): (ev: RunnerEvent) => Promise<void> {
  if (emit) {
    return async (ev) => {
      await emit(ev);
    };
  }
  // Default sink: append to events.ndjson so the dashboard SSE sees agent
  // events alongside phase/graph events.
  const path = join(runDir, "events.ndjson");
  return async (ev) => {
    await appendFile(path, serialize(ev) + "\n", "utf8");
  };
}
