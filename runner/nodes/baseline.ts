import type { RunnerState, RunnerStateUpdate } from "../state.ts";
import { runAgent } from "../agent-host.ts";

// Drives the baseline-collector agent and threads its output into state. The
// agent host validates the agent's structured output against a Zod schema;
// missing ANTHROPIC_API_KEY, SDK errors, and schema-validation failures all
// throw. We deliberately let those propagate — runner/index.ts's catch block
// emits `done ok:false`, sets `process.exitCode = 1`, and reaps the driver,
// which is the honest outcome for a failed audit. Swallowing the error here
// would turn a hard failure into an empty-findings success that a caller
// could mistake for a clean page.
//
// Runtime signals (`hasInteractive`, `treeEmpty`) drive the baseline→keyboard
// / baseline→visual / baseline→report conditional edge in runner/graph.ts.
export async function baselineNode(state: RunnerState): Promise<RunnerStateUpdate> {
  const out = await runAgent({ agentId: "baseline-collector", state });

  return {
    findings: out.findings,
    transcript: out.transcript,
    hasInteractive: out.signals.hasInteractive,
    treeEmpty: out.signals.treeEmpty,
    phaseStatus: { baseline: out.phaseOk ? "ok" : "error" },
  };
}
