import type { PhaseId, PhaseStatus } from "./state.ts";

// Stable NDJSON event schema consumed by the server's SSE endpoint and the web
// UI. Independent of LangGraph's internal `streamEvents` shapes so UI code
// never touches LangGraph types directly (see plan § Risks).

export type RunnerEvent =
  | { k: "run.start"; t: number; runId: string; url: string }
  | { k: "phase.status"; t: number; phase: PhaseId; status: PhaseStatus }
  | { k: "node.start"; t: number; node: PhaseId }
  | { k: "node.end"; t: number; node: PhaseId; ok: boolean; error?: string }
  | { k: "agent.start"; t: number; node: PhaseId; agentId: string; model: string }
  | {
      k: "agent.done";
      t: number;
      node: PhaseId;
      agentId: string;
      ok: boolean;
      error?: string;
      findings?: number;
      durationMs?: number;
    }
  | { k: "agent.chunk"; t: number; node: PhaseId; channel: "sr" | "tool" | "agent"; text: string }
  | { k: "finding"; t: number; id: string; criterion: string }
  | { k: "artifact"; t: number; key: string; path: string }
  | {
      k: "budget";
      t: number;
      node?: PhaseId;
      agentId?: string;
      usd: number;
      tokens: number;
    }
  | { k: "done"; t: number; ok: boolean; error?: string };

export function fromLangGraphEvent(ev: unknown): RunnerEvent | null {
  // Real mapping lands alongside the LangGraph `streamEvents(v2)` integration.
  // Until then the runner emits events directly via `emit()` below.
  void ev;
  return null;
}

export function now(): number {
  return Date.now();
}

export function serialize(ev: RunnerEvent): string {
  return JSON.stringify(ev);
}
