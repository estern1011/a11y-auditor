import type { RunnerState, RunnerStateUpdate } from "../state.ts";
import { runAgent } from "../agent-host.ts";

export async function baselineNode(state: RunnerState): Promise<RunnerStateUpdate> {
  const out = await runAgent({ agentId: "baseline-collector", state });

  return {
    findings: out.findings,
    transcript: out.transcript,
    hasInteractive: out.signals.hasInteractive,
    treeEmpty: out.signals.treeEmpty,
    phaseStatus: { baseline: "ok" },
  };
}
