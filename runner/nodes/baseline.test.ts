import { describe, test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { baselineNode } from "./baseline.ts";
import type { RunnerState } from "../state.ts";

async function makeState(overrides: Partial<RunnerState> = {}): Promise<RunnerState> {
  const runDir = await mkdtemp(join(tmpdir(), "baseline-node-test-"));
  return {
    runId: "test",
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
}

// baselineNode must NOT swallow agent exceptions — when the agent throws
// (missing ANTHROPIC_API_KEY, SDK error, schema-validation failure), the
// error has to propagate to runner/index.ts so `done ok:false` is emitted
// and the process exits non-zero. Swallowing the throw would silently turn a
// failed audit into an empty-findings "clean" run (Codex P1).
describe("baselineNode — error propagation", () => {
  test("re-throws when runAgent fails (e.g. missing ANTHROPIC_API_KEY)", async () => {
    const state = await makeState();
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      let caught: Error | undefined;
      try {
        await baselineNode(state);
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught?.message).toMatch(/ANTHROPIC_API_KEY is not set/);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
