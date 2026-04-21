import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UUID } from "node:crypto";

import type {
  Options,
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { runAgent, type QueryFactory } from "./agent-host.ts";
import type { RunnerState } from "./state.ts";

// ---------------------------------------------------------------------------
// Test harness: a stub Query that replays a pre-seeded script of SDK messages.
// Lets us drive the agent-host message loop without a network call or
// ANTHROPIC_API_KEY — same dep-injection pattern as spawnDaemon's fake daemon
// in driver.test.ts.
// ---------------------------------------------------------------------------

function stubQuery(messages: SDKMessage[]): Query {
  async function* gen(): AsyncGenerator<SDKMessage, void> {
    for (const m of messages) yield m;
  }
  const iter = gen();
  // Required Query methods are stubbed as no-ops; the agent-host only drives
  // the AsyncGenerator interface + interrupt() in this slice.
  const q = {
    next: iter.next.bind(iter),
    return: iter.return.bind(iter),
    throw: iter.throw.bind(iter),
    [Symbol.asyncIterator]() {
      return this;
    },
    interrupt: async () => undefined,
    setPermissionMode: async () => undefined,
    setModel: async () => undefined,
    setMaxThinkingTokens: async () => undefined,
    supportedCommands: async () => [],
    supportedModels: async () => [],
    mcpServerStatus: async () => [],
    accountInfo: async () => ({}),
    rewindFiles: async () => ({ canRewind: false }),
    setMcpServers: async () => ({ added: [], removed: [], errors: {} }),
    streamInput: async (_s: AsyncIterable<SDKUserMessage>) => undefined,
  };
  return q as unknown as Query;
}

const DUMMY_UUID = "11111111-1111-1111-1111-111111111111" as UUID;
const DUMMY_SESSION = "sess-test";

function makeAssistantMessage(text: string): SDKAssistantMessage {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    uuid: DUMMY_UUID,
    session_id: DUMMY_SESSION,
    // Only the fields our flatteners read; the rest we cast through.
    message: {
      id: "msg_1",
      role: "assistant",
      type: "message",
      model: "claude-opus-4-7",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      content: [{ type: "text", text }],
    } as unknown as SDKAssistantMessage["message"],
  };
}

function makeResultMessage(payload: unknown): SDKResultMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 10,
    duration_api_ms: 10,
    is_error: false,
    num_turns: 1,
    result: typeof payload === "string" ? payload : JSON.stringify(payload),
    total_cost_usd: 0.0042,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    } as unknown as SDKResultMessage["usage"],
    modelUsage: {},
    permission_denials: [],
    uuid: DUMMY_UUID,
    session_id: DUMMY_SESSION,
  };
}

function makeErrorResult(errors: string[]): SDKResultMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    duration_ms: 10,
    duration_api_ms: 10,
    is_error: true,
    num_turns: 1,
    total_cost_usd: 0,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    } as unknown as SDKResultMessage["usage"],
    modelUsage: {},
    permission_denials: [],
    errors,
    uuid: DUMMY_UUID,
    session_id: DUMMY_SESSION,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GOOD_PAYLOAD = {
  findings: [
    {
      id: "axe:image-alt:1",
      criterion: "1.1.1",
      severity: "critical",
      title: "<img> elements without alt",
    },
  ],
  transcript: [
    { t: 1_700_000_000_000, phase: "baseline", channel: "sr", text: "heading, level 1, Hello" },
  ],
  signals: { hasInteractive: true, treeEmpty: false, needsAuth: false },
};

async function seedAgentMd(dir: string): Promise<string> {
  const path = join(dir, "baseline-collector.md");
  await writeFile(
    path,
    `---\nname: baseline-collector\ndescription: test agent used by unit tests\ntools: Bash, Read\n---\n# Baseline Collector\n\nStub body.\n`,
    "utf8",
  );
  return dir;
}

function makeState(runDir: string): RunnerState {
  return {
    runId: "test-run",
    url: "https://example.com",
    sr: "orca",
    wcag: "AA",
    viewport: { w: 1440, h: 900 },
    driverPort: 7484,
    cdpPort: 9223,
    runDir,
    authEnvPath: undefined,
    findings: [],
    transcript: [],
    artifacts: {},
    phaseStatus: {
      boot: "ok",
      discover: "ok",
      auth: "pending",
      baseline: "running",
      keyboard: "pending",
      visual: "pending",
      report: "pending",
    },
    needsAuth: false,
    hasInteractive: true,
    treeEmpty: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAgent (agent-host)", () => {
  let workDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "agent-host-test-"));
    agentsDir = await mkdtemp(join(tmpdir(), "agent-host-agents-"));
    await seedAgentMd(agentsDir);
  });

  test("happy path: validates + returns structured output", async () => {
    const seen: string[] = [];
    const queryFn: QueryFactory = ({ prompt, options }) => {
      // Sanity-check the prompt / options shape — this is the contract between
      // runAgent and the SDK session.
      expect(typeof prompt).toBe("string");
      expect(prompt as string).toContain("cdp-port: 9223");
      expect(prompt as string).toContain("http-port: 7484");
      expect(options?.model).toBe("claude-opus-4-7");
      expect(options?.allowedTools).toEqual(["Bash", "Read"]);
      expect(options?.tools).toEqual(["Bash", "Read"]);
      expect(typeof options?.systemPrompt).toBe("string");
      expect(options?.systemPrompt as string).toContain("# Baseline Collector");
      seen.push("invoked");
      return stubQuery([
        makeAssistantMessage("Starting baseline..."),
        makeResultMessage(GOOD_PAYLOAD),
      ]);
    };

    const state = makeState(workDir);
    const events: string[] = [];
    const out = await runAgent(
      { agentId: "baseline-collector", state },
      {
        query: queryFn,
        agentsDir,
        env: { ANTHROPIC_API_KEY: "sk-test" },
        emit: async (ev) => {
          events.push(ev.k);
        },
      },
    );

    expect(seen).toEqual(["invoked"]);
    expect(out.findings[0].criterion).toBe("1.1.1");
    expect(out.signals.hasInteractive).toBe(true);
    expect(out.usage.tokens).toBeGreaterThan(0);
    expect(out.usage.costUsd).toBeCloseTo(0.0042, 5);
    expect(events).toContain("agent.start");
    expect(events).toContain("agent.done");
    expect(events).toContain("budget");

    // Raw messages are logged to agent-<id>.ndjson for inspection.
    const ndjson = await readFile(join(workDir, "agent-baseline-collector.ndjson"), "utf8");
    expect(ndjson.split("\n").filter((l) => l.trim().length > 0)).toHaveLength(2);
  });

  test("truncates agent-<id>.ndjson on session start", async () => {
    // Regression for codex review on PR #15: resetRunDir() scrubs the
    // top-level per-run files, but per-agent NDJSON is created inside
    // runAgent. Without an explicit truncate step, a retry with the same
    // --run-id appends new messages onto the prior run's log — mixing
    // sessions for debugging and (once the auth node lands) carrying prior
    // sensitive tool inputs into later logs.
    const ndjsonPath = join(workDir, "agent-baseline-collector.ndjson");
    await writeFile(
      ndjsonPath,
      `{"stale":"prior run message that must be cleared"}\n`,
      "utf8",
    );

    const queryFn: QueryFactory = () => stubQuery([makeResultMessage(GOOD_PAYLOAD)]);
    await runAgent(
      { agentId: "baseline-collector", state: makeState(workDir) },
      {
        query: queryFn,
        agentsDir,
        env: { ANTHROPIC_API_KEY: "sk-test" },
        emit: async () => undefined,
      },
    );

    const contents = await readFile(ndjsonPath, "utf8");
    expect(contents).not.toContain("stale");
    expect(contents).not.toContain("prior run");
    // Exactly one message from the new session (the result).
    const lines = contents.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"type":"result"');
  });

  test("defaults to empty tool surface when frontmatter omits 'tools:'", async () => {
    // Regression for codex review on PR #15: with `permissionMode:
    // bypassPermissions`, dropping the `tools` field lets the SDK fall back to
    // its default full toolset — broad tool access for an agent whose .md
    // forgot the `tools:` line. Fix: always pass an explicit `tools` array,
    // which `[]` tells the SDK to disable all built-in tools.
    const noToolsDir = await mkdtemp(join(tmpdir(), "agent-host-notools-"));
    await writeFile(
      join(noToolsDir, "baseline-collector.md"),
      `---\nname: baseline-collector\ndescription: no tools declared\n---\nBody.\n`,
      "utf8",
    );

    let capturedOptions: Options | undefined;
    const queryFn: QueryFactory = ({ options }) => {
      capturedOptions = options;
      return stubQuery([makeResultMessage(GOOD_PAYLOAD)]);
    };

    await runAgent(
      { agentId: "baseline-collector", state: makeState(workDir) },
      {
        query: queryFn,
        agentsDir: noToolsDir,
        env: { ANTHROPIC_API_KEY: "sk-test" },
        emit: async () => undefined,
      },
    );

    expect(capturedOptions?.tools).toEqual([]);
    expect(capturedOptions?.allowedTools).toEqual([]);
  });

  test("loud throw on Zod mismatch includes payload", async () => {
    const badPayload = {
      findings: [
        { id: "x", criterion: "1.1.1", severity: "info" /* not a valid severity */, title: "t" },
      ],
      transcript: [],
      signals: { hasInteractive: true, treeEmpty: false, needsAuth: false },
    };

    const queryFn: QueryFactory = () => stubQuery([makeResultMessage(badPayload)]);

    let caught: Error | undefined;
    try {
      await runAgent(
        { agentId: "baseline-collector", state: makeState(workDir) },
        {
          query: queryFn,
          agentsDir,
          env: { ANTHROPIC_API_KEY: "sk-test" },
          emit: async () => undefined,
        },
      );
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toMatch(/Zod validation failed/);
    // The offending payload is included verbatim in the error so a bad run is
    // diagnosable from the single message — no silent default.
    expect(caught?.message).toContain('"severity": "info"');
  });

  test("throws when the final message is non-JSON", async () => {
    const queryFn: QueryFactory = () =>
      stubQuery([makeResultMessage("not JSON at all, prose instead")]);

    let caught: Error | undefined;
    try {
      await runAgent(
        { agentId: "baseline-collector", state: makeState(workDir) },
        {
          query: queryFn,
          agentsDir,
          env: { ANTHROPIC_API_KEY: "sk-test" },
          emit: async () => undefined,
        },
      );
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toMatch(/non-JSON final message/);
  });

  test("requires ANTHROPIC_API_KEY for non-auth agents", async () => {
    let caught: Error | undefined;
    try {
      await runAgent(
        { agentId: "baseline-collector", state: makeState(workDir) },
        { agentsDir, env: {} },
      );
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toMatch(/ANTHROPIC_API_KEY missing/);
  });

  test("propagates agent error results as thrown errors", async () => {
    const queryFn: QueryFactory = () =>
      stubQuery([makeErrorResult(["rate limit hit", "retry exhausted"])]);

    let caught: Error | undefined;
    try {
      await runAgent(
        { agentId: "baseline-collector", state: makeState(workDir) },
        {
          query: queryFn,
          agentsDir,
          env: { ANTHROPIC_API_KEY: "sk-test" },
          emit: async () => undefined,
        },
      );
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toMatch(/rate limit hit/);
  });

  test("throws when session ends without any result message", async () => {
    const queryFn: QueryFactory = () => stubQuery([makeAssistantMessage("still thinking...")]);

    let caught: Error | undefined;
    try {
      await runAgent(
        { agentId: "baseline-collector", state: makeState(workDir) },
        {
          query: queryFn,
          agentsDir,
          env: { ANTHROPIC_API_KEY: "sk-test" },
          emit: async () => undefined,
        },
      );
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toMatch(/session ended without a result message/);
  });
});
