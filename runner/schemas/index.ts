import type { ZodTypeAny } from "zod";

import {
  BASELINE_COLLECTOR_JSON_SCHEMA,
  BaselineCollectorOutputSchema,
} from "./baseline-collector.ts";

// Registry of per-agent output contracts. Each entry pairs:
//   - `zod` — the runtime Zod schema the runner validates the agent's
//     structured output against before pushing into state. Validation failures
//     must throw loudly (see runner/agent-host.ts) so the report never
//     silently defaults back to empty findings.
//   - `jsonSchema` — the JSON-Schema twin handed to the Agent SDK's
//     `outputFormat`. The SDK uses it to constrain the model's output to the
//     same shape Zod will later validate.
//
// Agents that don't yet have a schema (keyboard-walker, visual-cross-referencer
// — next slice; auth — Phase B) have no entry and runAgent returns defaults.

export interface AgentSchemaEntry {
  zod: ZodTypeAny;
  jsonSchema: Record<string, unknown>;
}

export const AGENT_SCHEMAS: Record<string, AgentSchemaEntry> = {
  "baseline-collector": {
    zod: BaselineCollectorOutputSchema,
    jsonSchema: BASELINE_COLLECTOR_JSON_SCHEMA,
  },
};
