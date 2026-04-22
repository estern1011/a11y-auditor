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
    // Persist `needsAuth` even though the graph's current conditional edges
    // route through `auth` only on the discover→auth transition — if the
    // baseline agent detects a login/paywall gate the discover heuristic
    // missed, downstream phases and the ACR reporting pipeline should still
    // see the signal. Dropping it would leave `state.needsAuth` stale.
    needsAuth: out.signals.needsAuth,
    phaseStatus: { baseline: out.phaseOk ? "ok" : "error" },
  };
}
