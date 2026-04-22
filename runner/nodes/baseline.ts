import type { RunnerState, RunnerStateUpdate } from "../state.ts";
import { runAgent } from "../agent-host.ts";

// Drives the baseline-collector agent and threads its output into state. The
// agent host validates the agent's structured output against a Zod schema; on
// parse failure it throws, which we translate into a `baseline: "error"`
// phase status (the graph still runs to report so the UI has something to
// render rather than hanging).
//
// Runtime signals (`hasInteractive`, `treeEmpty`) drive the baseline→keyboard
// / baseline→visual / baseline→report conditional edge in runner/graph.ts.
export async function baselineNode(state: RunnerState): Promise<RunnerStateUpdate> {
  try {
    const out = await runAgent({ agentId: "baseline-collector", state });

    return {
      findings: out.findings,
      transcript: out.transcript,
      hasInteractive: out.signals.hasInteractive,
      treeEmpty: out.signals.treeEmpty,
      phaseStatus: { baseline: out.phaseOk ? "ok" : "error" },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Surface the failure in transcript.json so the dashboard has a breadcrumb.
    // Fall back to treating the page as if it had interactive content and a
    // non-empty tree — the graph then proceeds through keyboard+visual (which
    // still return defaults this slice) and on into report, which is better
    // than stalling the run on a single agent error.
    return {
      findings: [],
      transcript: [
        {
          t: Date.now(),
          phase: "baseline",
          channel: "system",
          text: `baseline agent error: ${message}`,
        },
      ],
      hasInteractive: true,
      treeEmpty: false,
      phaseStatus: { baseline: "error" },
    };
  }
}
