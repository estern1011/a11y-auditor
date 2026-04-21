import type { RunnerState, RunnerStateUpdate } from "../state.ts";

// Auth node remains scaffold-only: the interactive-login secret flow is
// Phase B per docs/web-dashboard-plan.md. The baseline agent-host plumbing
// (`runAgent({ agentId: "auth", state })`) is ready to go once that design
// note lands — until then we just clear the needsAuth flag so the graph
// completes.
export async function authNode(_state: RunnerState): Promise<RunnerStateUpdate> {
  await Promise.resolve();
  return {
    needsAuth: false,
    phaseStatus: { auth: "ok" },
  };
}
