import type { RunnerState, RunnerStateUpdate } from "../state.ts";
import { runAgent } from "../agent-host.ts";

export async function visualNode(state: RunnerState): Promise<RunnerStateUpdate> {
  const out = await runAgent({ agentId: "visual-cross-referencer", state });

  return {
    findings: out.findings,
    transcript: out.transcript,
    phaseStatus: { visual: "ok" },
  };
}
