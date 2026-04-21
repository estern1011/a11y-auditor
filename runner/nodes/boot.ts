import type { RunnerState, RunnerStateUpdate } from "../state.ts";
import { writeMeta } from "../tools/run-dir.ts";

// bootNode confirms the driver is up (ports were chosen + waited on in
// runner/index.ts before graph.invoke) and rewrites meta.json with the real
// ports. Everything else in the graph can now depend on driverPort/cdpPort
// being live.
export async function bootNode(state: RunnerState): Promise<RunnerStateUpdate> {
  if (!state.driverPort || !state.cdpPort) {
    throw new Error("bootNode: driverPort/cdpPort missing from initial state");
  }

  await writeMeta(state.runDir, {
    runId: state.runId,
    url: state.url,
    sr: state.sr,
    wcag: state.wcag,
    viewport: state.viewport,
    driverPort: state.driverPort,
    cdpPort: state.cdpPort,
    startedAt: new Date().toISOString(),
    authProvided: Boolean(state.authEnvPath),
  });

  return {
    phaseStatus: { boot: "ok" },
  };
}
