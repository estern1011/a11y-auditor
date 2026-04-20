import type { RunnerState, RunnerStateUpdate } from "../state.ts";
import { runAgent } from "../agent-host.ts";

export async function authNode(state: RunnerState): Promise<RunnerStateUpdate> {
  await runAgent({
    agentId: "auth",
    state,
    // Auth agent file doesn't exist yet; node is scaffolded for the graph shape.
    // Implementation lands alongside the auth flow design note (see open questions).
  });

  return {
    needsAuth: false,
    phaseStatus: { auth: "ok" },
  };
}
