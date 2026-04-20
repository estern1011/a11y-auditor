import type { RunnerState, RunnerStateUpdate } from "../state.ts";
import { runCollect } from "../tools/collect.ts";

export async function discoverNode(state: RunnerState): Promise<RunnerStateUpdate> {
  const evidence = await runCollect({
    url: state.url,
    driverPort: state.driverPort,
    cdpPort: state.cdpPort,
    runDir: state.runDir,
  });

  return {
    artifacts: evidence.artifacts,
    transcript: evidence.transcript,
    needsAuth: evidence.needsAuth,
    phaseStatus: { discover: "ok" },
  };
}
