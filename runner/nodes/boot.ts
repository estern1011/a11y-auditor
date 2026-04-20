import type { RunnerState, RunnerStateUpdate } from "../state.ts";
import { startDriver } from "../tools/driver.ts";
import { writeMeta } from "../tools/run-dir.ts";

export async function bootNode(state: RunnerState): Promise<RunnerStateUpdate> {
  const { driverPort, cdpPort } = await startDriver({
    sr: state.sr,
    url: state.url,
    viewport: state.viewport,
  });

  await writeMeta(state.runDir, {
    runId: state.runId,
    url: state.url,
    sr: state.sr,
    wcag: state.wcag,
    viewport: state.viewport,
    driverPort,
    cdpPort,
    startedAt: new Date().toISOString(),
  });

  return {
    driverPort,
    cdpPort,
    phaseStatus: { boot: "ok" },
  };
}
