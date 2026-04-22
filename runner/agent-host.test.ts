import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAgent, buildUserPrompt, type QueryFactory } from "./agent-host.ts";
import type { RunnerState } from "./state.ts";

// Build a state skeleton matching what the graph would hand the baseline node
// at runtime. All non-agent fields are left at their defaults.
async function makeState(overrides: Partial<RunnerState> = {}): Promise<RunnerState> {
  const runDir = await mkdtemp(join(tmpdir(), "agent-host-test-"));
  await mkdir(runDir, { recursive: true });
  const base: RunnerState = {
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
      boot: "pending",
      discover: "pending",
      auth: "pending",
      baseline: "pending",
      keyboard: "pending",
      visual: "pending",
      report: "pending",
    },
    needsAuth: false,
    hasInteractive: true,
    treeEmpty: false,
    ...overrides,
  };
  return base;
}

// Minimal fake Query — Agent SDK's Query extends AsyncGenerator, but for the
// fields runAgent actually reads (the iteration loop + terminal 'result'
// message) a plain async iterator is enough. Control methods aren't exercised
// by the happy path, so we just expose the iterator shape.
function fakeQuery(messages: unknown[]): AsyncGenerator<unknown, void> {
  async function* gen(): AsyncGenerator<unknown, void> {
    for (const m of messages) {
      await Promise.resolve();
      yield m;
    }
  }
  return gen();
}

function successResultMessage(structured: unknown) {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1234,
    duration_api_ms: 1000,
    is_error: false,
    num_turns: 2,
    result: typeof structured === "string" ? structured : JSON.stringify(structured),
    total_cost_usd: 0.042,
    usage: { input_tokens: 500, output_tokens: 300 },
    modelUsage: {},
    permission_denials: [],
    structured_output: typeof structured === "string" ? undefined : structured,
    uuid: "00000000-0000-0000-0000-000000000000",
    session_id: "sess",
  };
}

function assistantTextMessage(text: string) {
  return {
    type: "assistant",
    message: { content: [{ type: "text", text }] },
    parent_tool_use_id: null,
    uuid: "00000000-0000-0000-0000-000000000001",
    session_id: "sess",
  };
}

function assistantToolUseMessage(name: string, input: Record<string, unknown>) {
  return {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "tu_1", name, input }],
    },
    parent_tool_use_id: null,
    uuid: "00000000-0000-0000-0000-000000000002",
    session_id: "sess",
  };
}

beforeEach(() => {
  // Runner enforces ANTHROPIC_API_KEY presence for non-auth agents; tests
  // inject a fake query factory so no actual key is used, but the presence
  // check still needs to pass.
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "test-fake-key";
});

describe("runAgent (baseline-collector, stubbed query)", () => {
  test("parses structured output and threads findings + signals into the result", async () => {
    const state = await makeState();
    const payload = {
      findings: [
        {
          id: "axe:image-alt:0",
          criterion: "1.1.1",
          severity: "critical",
          title: "Missing alt text",
          sources: ["axe"],
        },
      ],
      signals: { hasInteractive: true, treeEmpty: false, needsAuth: false },
    };

    const queryFactory: QueryFactory = () =>
      fakeQuery([
        assistantTextMessage("Running collect.ts now."),
        assistantToolUseMessage("Bash", { command: "bun collect.ts https://example.com" }),
        successResultMessage(payload),
      ]) as never;

    const out = await runAgent({ agentId: "baseline-collector", state }, { queryFactory });

    expect(out.phaseOk).toBe(true);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].criterion).toBe("1.1.1");
    expect(out.signals).toEqual({ hasInteractive: true, treeEmpty: false, needsAuth: false });

    // Transcript narration includes one agent text line + one tool line
    const channels = out.transcript.map((t) => t.channel);
    expect(channels).toContain("agent");
    expect(channels).toContain("tool");
    const toolLine = out.transcript.find((t) => t.channel === "tool");
    expect(toolLine?.text).toMatch(/Bash:/);

    // Per-agent raw log was written
    const log = await readFile(join(state.runDir, "agent-baseline-collector.ndjson"), "utf8");
    expect(log.trim().split("\n").length).toBeGreaterThanOrEqual(3);

    // Events.ndjson got agent.start, budget, and agent.done lines
    const events = await readFile(join(state.runDir, "events.ndjson"), "utf8");
    expect(events).toMatch(/"k":"agent.start"/);
    expect(events).toMatch(/"k":"agent.done".*"ok":true/);
    expect(events).toMatch(/"k":"budget"/);
  });

  test("accepts structured output encoded as JSON string when structured_output is absent", async () => {
    const state = await makeState();
    const payload = {
      findings: [],
      signals: { hasInteractive: false, treeEmpty: false, needsAuth: false },
    };

    const resultMsg = successResultMessage(JSON.stringify(payload));
    // Ensure the JSON-parse fallback path runs
    (resultMsg as { structured_output?: unknown }).structured_output = undefined;

    const queryFactory: QueryFactory = () => fakeQuery([resultMsg]) as never;

    const out = await runAgent({ agentId: "baseline-collector", state }, { queryFactory });
    expect(out.phaseOk).toBe(true);
    expect(out.signals.hasInteractive).toBe(false);
  });

  test("throws with offending payload when schema validation fails", async () => {
    const state = await makeState();
    const bad = {
      findings: [
        { id: "x", criterion: "bogus", severity: "whoops", title: "t" },
      ],
      signals: { hasInteractive: true, treeEmpty: false, needsAuth: false },
    };
    const queryFactory: QueryFactory = () =>
      fakeQuery([successResultMessage(bad)]) as never;

    let caught: Error | undefined;
    try {
      await runAgent({ agentId: "baseline-collector", state }, { queryFactory });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    // Loud failure mode: the error message must include the offending payload
    // so a bad run is inspectable without re-running.
    expect(caught?.message).toMatch(/schema validation/);
    expect(caught?.message).toMatch(/Payload:/);
    expect(caught?.message).toMatch(/"criterion":"bogus"/);
  });

  test("throws when the query ends without a result message", async () => {
    const state = await makeState();
    const queryFactory: QueryFactory = () =>
      fakeQuery([assistantTextMessage("never finished")]) as never;

    let caught: Error | undefined;
    try {
      await runAgent({ agentId: "baseline-collector", state }, { queryFactory });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toMatch(/without a 'result' message/);
  });

  test("throws when Agent SDK returns a non-success result", async () => {
    const state = await makeState();
    const errResult = {
      type: "result",
      subtype: "error_during_execution",
      duration_ms: 10,
      duration_api_ms: 0,
      is_error: true,
      num_turns: 0,
      total_cost_usd: 0,
      usage: {},
      modelUsage: {},
      permission_denials: [],
      errors: ["rate_limit"],
      uuid: "00000000-0000-0000-0000-000000000099",
      session_id: "sess",
    };
    const queryFactory: QueryFactory = () => fakeQuery([errResult]) as never;

    let caught: Error | undefined;
    try {
      await runAgent({ agentId: "baseline-collector", state }, { queryFactory });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toMatch(/rate_limit/);
  });

  test("fails loudly when ANTHROPIC_API_KEY is missing for a non-auth agent", async () => {
    const state = await makeState();
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      let caught: Error | undefined;
      try {
        await runAgent({ agentId: "baseline-collector", state }, { queryFactory: () => fakeQuery([]) as never });
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught?.message).toMatch(/ANTHROPIC_API_KEY is not set/);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  test("scaffolded agents (no schema) still return defaults end-to-end", async () => {
    const state = await makeState();
    // keyboard-walker has no schema entry yet — scope defers to next slice.
    const out = await runAgent(
      { agentId: "keyboard-walker", state },
      { queryFactory: () => fakeQuery([]) as never },
    );
    expect(out.phaseOk).toBe(true);
    expect(out.findings).toEqual([]);
    expect(out.signals.hasInteractive).toBe(true);
  });
});

describe("buildUserPrompt", () => {
  test("includes all inputs the orchestrator prompt mentions", async () => {
    const state = await makeState({
      url: "https://example.com/path",
      driverPort: 7484,
      cdpPort: 9223,
      sr: "orca",
    });
    const prompt = buildUserPrompt({ agentId: "baseline-collector", state });
    expect(prompt).toContain("baseline-collector");
    expect(prompt).toContain("https://example.com/path");
    expect(prompt).toContain("drivers/orca/driver.ts");
    expect(prompt).toContain("cdp-port: 9223");
    expect(prompt).toContain("http-port: 7484");
    expect(prompt).toContain("output schema");
  });

  test("points voiceover runs at the voiceover driver", async () => {
    const state = await makeState({ sr: "voiceover" });
    const prompt = buildUserPrompt({ agentId: "baseline-collector", state });
    expect(prompt).toContain("drivers/voiceover/driver.ts");
    expect(prompt).not.toContain("drivers/orca/driver.ts");
  });
});

describe("runAgent artifact filename creation", () => {
  test("writes agent-<id>.ndjson to state.runDir", async () => {
    const state = await makeState();
    const payload = {
      findings: [],
      signals: { hasInteractive: true, treeEmpty: false, needsAuth: false },
    };
    const queryFactory: QueryFactory = () =>
      fakeQuery([successResultMessage(payload)]) as never;

    await runAgent({ agentId: "baseline-collector", state }, { queryFactory });
    const raw = await readFile(join(state.runDir, "agent-baseline-collector.ndjson"), "utf8");
    expect(raw.trim().length).toBeGreaterThan(0);
    // Each line is a JSON object — trivial parse check.
    for (const line of raw.trim().split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

// Static fixture documents the "well-formed baseline output" shape. The Zod
// schema + this fixture are the wire contract; if either drifts, tests fail.
describe("fixtures", () => {
  test("fixtures/baseline-collector-valid.json parses via the Zod schema", async () => {
    const path = join(import.meta.dir, "fixtures", "baseline-collector-valid.json");
    const { BaselineCollectorOutputSchema } = await import(
      "./schemas/baseline-collector.ts"
    );
    const raw = await readFile(path, "utf8");
    const result = BaselineCollectorOutputSchema.safeParse(JSON.parse(raw));
    expect(result.success).toBe(true);
  });
});
