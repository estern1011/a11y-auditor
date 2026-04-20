import type { RunnerState, RunnerStateUpdate } from "../state.ts";
import { runAgent } from "../agent-host.ts";

export async function keyboardNode(state: RunnerState): Promise<RunnerStateUpdate> {
  const out = await runAgent({ agentId: "keyboard-walker", state });

  return {
    findings: out.findings,
    transcript: out.transcript,
    treeEmpty: out.signals.treeEmpty,
    phaseStatus: { keyboard: "ok" },
  };
}
