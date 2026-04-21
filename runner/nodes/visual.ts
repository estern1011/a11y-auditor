import type { RunnerState, RunnerStateUpdate } from "../state.ts";

// Scaffold-only: visual agent lands in slice #5. Mirrors keyboardNode — phase
// flips to "ok" so the graph completes end-to-end, but no findings/transcript
// are threaded. See baseline.ts for the real agent-host wiring pattern the
// next slice will copy.
export async function visualNode(_state: RunnerState): Promise<RunnerStateUpdate> {
  await Promise.resolve();
  return {
    phaseStatus: { visual: "ok" },
  };
}
