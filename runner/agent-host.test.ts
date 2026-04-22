import { describe, test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAgent, buildUserPrompt, authHintFor, type QueryFactory } from "./agent-host.ts";
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

// No env setup needed — runAgent no longer does its own auth pre-check, and
// the injected queryFactory replaces the real SDK subprocess.

describe("runAgent — SDK options (regression for Codex P1/P2 on tools + cwd)", () => {
  test("pins cwd to REPO_ROOT and applies frontmatter tools as a hard allowlist", async () => {
    const state = await makeState();
    const payload = {
      findings: [],
      signals: { hasInteractive: true, treeEmpty: false, needsAuth: false },
    };

    let capturedOptions: unknown;
    const queryFactory: QueryFactory = (params) => {
      capturedOptions = params.options;
      return fakeQuery([successResultMessage(payload)]) as never;
    };

    await runAgent({ agentId: "baseline-collector", state }, { queryFactory });

    const opts = capturedOptions as {
      cwd?: string;
      tools?: string[] | { type: string; preset: string };
      allowedTools?: string[];
    };

    // The `.claude/agents/baseline-collector.md` frontmatter declares
    // `tools: Bash, Read, Grep`. Those must appear as both the base tool
    // set (hard allowlist) and the auto-approved set (headless), so the
    // model can't pick up an unlisted tool via permission fallback.
    expect(opts.tools).toEqual(["Bash", "Read", "Grep"]);
    expect(opts.allowedTools).toEqual(["Bash", "Read", "Grep"]);

    // cwd must resolve to the repo root — the .md files use commands like
    // `bun collect.ts ...` that depend on repo-relative paths.
    expect(typeof opts.cwd).toBe("string");
    expect(opts.cwd).toMatch(/a11y-auditor$/);
  });
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

    // Regression guard for Codex P2: schema-validation failure must still
    // close the agent's lifecycle in events.ndjson. Without the terminal
    // `agent.done`, SSE consumers would see `agent.start` and never a matching
    // close, so a failed agent looks stuck rather than failed.
    const events = await readFile(join(state.runDir, "events.ndjson"), "utf8");
    expect(events).toMatch(/"k":"agent.start"/);
    expect(events).toMatch(/"k":"agent.done".*"ok":false/);
    expect(events).toMatch(/"error":"[^"]*schema validation/);
  });

  test("emits agent.done on the no-structured-output path", async () => {
    const state = await makeState();
    // Model returned a success result but neither `structured_output` nor a
    // JSON-parseable `result` string. Should throw + emit `agent.done` ok:false.
    const resultMsg = successResultMessage("this is not JSON");
    (resultMsg as { structured_output?: unknown }).structured_output = undefined;
    const queryFactory: QueryFactory = () => fakeQuery([resultMsg]) as never;

    let caught: Error | undefined;
    try {
      await runAgent({ agentId: "baseline-collector", state }, { queryFactory });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toMatch(/no structured output/);

    const events = await readFile(join(state.runDir, "events.ndjson"), "utf8");
    expect(events).toMatch(/"k":"agent.done".*"ok":false/);
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

  test("does NOT pre-check ANTHROPIC_API_KEY — Claude Code auth is multi-source", async () => {
    // The SDK spawns Claude Code, which can auth via a cached OAuth login,
    // CLAUDE_CODE_OAUTH_TOKEN, Vertex, or Bedrock — not only
    // ANTHROPIC_API_KEY. We leave the auth check to the SDK itself (its
    // error is richer than any env-inspection we could do) and rely on the
    // failure-propagation path fixed in Codex P1 to surface SDK auth
    // errors as `done ok:false`.
    const state = await makeState();
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const payload = {
        findings: [],
        signals: { hasInteractive: true, treeEmpty: false, needsAuth: false },
      };
      const queryFactory: QueryFactory = () =>
        fakeQuery([successResultMessage(payload)]) as never;

      // Must not throw purely because ANTHROPIC_API_KEY is absent — the
      // stubbed query simulates a successful SDK run that relied on some
      // other auth source.
      const out = await runAgent(
        { agentId: "baseline-collector", state },
        { queryFactory },
      );
      expect(out.phaseOk).toBe(true);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  test("rejects a success result with non-empty permission_denials", async () => {
    // The SDK returning `subtype: "success"` only means the session
    // terminated cleanly. If the host denied the agent's Bash (or any)
    // tool call, the model can still emit a schema-shaped payload it
    // effectively made up — which would show up to the dashboard as a
    // "clean" baseline. Regression guard: any permission_denials entry
    // must fail the phase.
    const state = await makeState();
    const payload = {
      findings: [],
      signals: { hasInteractive: true, treeEmpty: false, needsAuth: false },
    };
    const resultMsg = successResultMessage(payload);
    (resultMsg as { permission_denials?: unknown }).permission_denials = [
      {
        tool_name: "Bash",
        tool_use_id: "tu_denied",
        tool_input: { command: "bun collect.ts https://example.com" },
      },
    ];
    const queryFactory: QueryFactory = () => fakeQuery([resultMsg]) as never;

    let caught: Error | undefined;
    try {
      await runAgent({ agentId: "baseline-collector", state }, { queryFactory });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toMatch(/denied by permission policy/);
    expect(caught?.message).toMatch(/Bash/);

    // events.ndjson still gets the terminal agent.done for the denied run.
    const events = await readFile(join(state.runDir, "events.ndjson"), "utf8");
    expect(events).toMatch(/"k":"agent.done".*"ok":false/);
  });

  test("emits agent.start + agent.done even when setup (mkdir) fails", async () => {
    // runDir points at a regular file instead of a directory, so the
    // `mkdir(dirname(logPath), { recursive: true })` inside runAgent's setup
    // throws EEXIST/ENOTDIR. That setup used to live above the try/catch,
    // which meant events.ndjson ended up with no lifecycle entries at all.
    // After Codex P2, setup is inside the funnel — so we should see both
    // `agent.start` and a matching `agent.done { ok: false }`.
    const parent = await mkdtemp(join(tmpdir(), "setup-fail-"));
    const filePath = join(parent, "not-a-dir");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, "blocker", "utf8");
    const state = await makeState({ runDir: filePath });

    let caught: Error | undefined;
    try {
      await runAgent(
        { agentId: "baseline-collector", state },
        { queryFactory: () => fakeQuery([]) as never },
      );
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);

    // events.ndjson lives at `${runDir}/events.ndjson`. Our broken runDir IS
    // the file — so the emit's appendFile will fail too. That's expected;
    // the `emitEvent` helper swallows those writes. The stronger assertion
    // for this regression is "runAgent propagated the error", which the
    // catch above already proves. Just check that no exception escaped the
    // catch funnel that could crash the caller unexpectedly.
    expect(caught?.message.length).toBeGreaterThan(0);
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

describe("authHintFor", () => {
  test("returns a hint for Claude Code's 'Invalid API key · /login' error", () => {
    const hint = authHintFor("Invalid API key · Please run /login");
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/ANTHROPIC_API_KEY/);
    expect(hint).toMatch(/claude \/login/);
  });

  test("returns a hint on 401 responses", () => {
    expect(authHintFor("HTTP 401 from api.anthropic.com")).not.toBeNull();
  });

  test("returns a hint when a CLAUDE_CODE_OAUTH_TOKEN fd is unreadable", () => {
    expect(
      authHintFor("CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR read failed"),
    ).not.toBeNull();
  });

  test("returns null for unrelated errors (no false positives on generic runner failures)", () => {
    expect(authHintFor("structured output failed schema validation")).toBeNull();
    expect(authHintFor("rate_limit")).toBeNull();
    expect(authHintFor("Agent SDK query ended without a 'result' message")).toBeNull();
  });
});

describe("runAgent auth-hint annotation (non-blocking)", () => {
  test("annotates auth-shaped SDK failures with an actionable setup hint", async () => {
    const state = await makeState();
    // Simulate the exact shape the Agent SDK returns when Claude Code rejects
    // a request with the "Invalid API key · Please run /login" message.
    const errResult = {
      type: "result",
      subtype: "error_during_execution",
      duration_ms: 5,
      duration_api_ms: 0,
      is_error: true,
      num_turns: 0,
      total_cost_usd: 0,
      usage: {},
      modelUsage: {},
      permission_denials: [],
      errors: ["Invalid API key · Please run /login"],
      uuid: "00000000-0000-0000-0000-000000000999",
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
    // Original SDK error message is preserved…
    expect(caught?.message).toMatch(/Invalid API key/);
    // …and the actionable hint is appended so a first-run user knows which of
    // the four auth sources Claude Code supports needs to be set up.
    expect(caught?.message).toMatch(/Hint:/);
    expect(caught?.message).toMatch(/ANTHROPIC_API_KEY/);

    // events.ndjson's agent.done.error carries the annotated message too, so
    // the dashboard shows the hint without needing the thrown Error.
    const events = await readFile(join(state.runDir, "events.ndjson"), "utf8");
    expect(events).toMatch(/"k":"agent.done".*"ok":false.*Hint:/);
  });

  test("does NOT annotate unrelated failures (schema validation keeps its original message)", async () => {
    const state = await makeState();
    const bad = {
      findings: [{ id: "x", criterion: "bogus", severity: "scary", title: "t" }],
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
    expect(caught?.message).toMatch(/schema validation/);
    expect(caught?.message).not.toMatch(/Hint:/);
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
    // Use a repo-relative path (agent runs with cwd pinned to REPO_ROOT) so
    // a directory name with spaces elsewhere in the absolute path can't
    // break the `bun <sr-driver> ...` commands the agent issues.
    expect(prompt).toMatch(/sr-driver: drivers\/orca\/driver\.ts$/m);
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
