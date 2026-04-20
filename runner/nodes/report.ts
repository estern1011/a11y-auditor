import type { RunnerState, RunnerStateUpdate } from "../state.ts";
import { writeFindings, writeMarkers, writeTranscript } from "../tools/run-dir.ts";

export async function reportNode(state: RunnerState): Promise<RunnerStateUpdate> {
  await writeFindings(state.runDir, state.findings);
  await writeMarkers(state.runDir, state.findings);
  await writeTranscript(state.runDir, state.transcript);

  return {
    phaseStatus: { report: "ok" },
  };
}
