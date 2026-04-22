import { describe, test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
// (SDK auth error, SDK subprocess failure, schema-validation failure), the
// error has to propagate to runner/index.ts so `done ok:false` is emitted
// and the process exits non-zero. Swallowing the throw would silently turn a
// failed audit into an empty-findings "clean" run (Codex P1).
describe("baselineNode — error propagation", () => {
  test("re-throws when runAgent fails (runDir points at a file, not a directory)", async () => {
    // Force an early failure inside runAgent by giving it a runDir that's
    // actually a file — `mkdir(dirname(logPath), { recursive: true })` fails
    // with ENOTDIR, which runAgent surfaces through its `agent.done`
    // failure path. Any similar downstream throw (missing Claude auth,
    // malformed structured output, schema mismatch) must propagate the
    // same way; this test pins the contract cheaply without spawning the
    // SDK subprocess.
    const parent = await mkdtemp(join(tmpdir(), "baseline-node-err-"));
    const filePath = join(parent, "is-a-file");
    await writeFile(filePath, "not a directory", "utf8");
    await mkdir(parent, { recursive: true });
    const state = await makeState({ runDir: filePath });

    let caught: Error | undefined;
    try {
      await baselineNode(state);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    // `mkdir(dirname(logPath), { recursive: true })` surfaces EEXIST on
    // Linux/macOS when the path is occupied by a regular file. Other
    // legitimate failure modes (ENOTDIR when the file is deeper in the
    // tree, or runAgent's own wrapper text) are also fine — the only
    // assertion we care about is "something bubbled out of baselineNode",
    // proving the catch-and-swallow is really gone.
    expect(caught?.message).toMatch(/EEXIST|ENOTDIR|not a directory|agent|runAgent/i);
  });
});
