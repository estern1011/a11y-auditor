import type { RunnerState, RunnerStateUpdate } from "../state.ts";

// Scaffold-only: keyboard agent lands in slice #5 once baseline's shape is
// proven. Returning the default partial keeps the conditional edges routing
// (treeEmpty stays false so we still flow baseline → keyboard → visual →
// report end-to-end), and phaseStatus flips to "ok" so the UI's phase rail
// doesn't look stuck. The task explicitly scopes this slice to baseline only.
export async function keyboardNode(_state: RunnerState): Promise<RunnerStateUpdate> {
  await Promise.resolve();
  return {
    phaseStatus: { keyboard: "ok" },
  };
}
