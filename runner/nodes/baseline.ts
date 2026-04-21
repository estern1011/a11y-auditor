import type { RunnerState, RunnerStateUpdate } from "../state.ts";
import { runAgent } from "../agent-host.ts";
import { appendEvent } from "../tools/run-dir.ts";
import { now, serialize, type RunnerEvent } from "../events.ts";

// Threads the baseline-collector agent's structured output into state:
//   - findings are pushed through the additive reducer
//   - the SR-flavored transcript is appended
//   - hasInteractive / treeEmpty drive the conditional edge out of `baseline`
//
// On agent failure (network, schema mismatch, timeout) we mark the phase
// `error` and re-throw. The re-throw is load-bearing — the plan's "Agent
// output → state contract" risk is that a silent default masks a misbehaving
// agent. A thrown error surfaces in the runner's top-level catch which writes
// `{ done: false, error }` to events.ndjson.
export async function baselineNode(state: RunnerState): Promise<RunnerStateUpdate> {
  try {
    const out = await runAgent({ agentId: "baseline-collector", state });
    return {
      findings: out.findings,
      transcript: out.transcript,
      hasInteractive: out.signals.hasInteractive,
      treeEmpty: out.signals.treeEmpty,
      phaseStatus: { baseline: "ok" },
    };
  } catch (err) {
    const ev: RunnerEvent = {
      k: "phase.status",
      t: now(),
      phase: "baseline",
      status: "error",
    };
    // LangGraph discards partial patches from throwing nodes, so the status
    // patch would be lost. Write the status event directly to events.ndjson so
    // the dashboard's phase rail still flips to error even though the run dies.
    try {
      await appendEvent(state.runDir, serialize(ev));
    } catch {
      // best-effort — the top-level catch will still surface the original err
    }
    throw err;
  }
}
