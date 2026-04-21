import type { z } from "zod";

import { baselineAgentSchema } from "./baseline.ts";
import { agentOutputSchema } from "./common.ts";

// Per-agent Zod schemas. Today keyboard and visual share the base shape (they
// ship in the next slice); baseline is the only agent whose node threads real
// output into state, so it's the one that must validate against a dedicated
// schema alias.
//
// AgentId is re-declared here (rather than imported from agent-host.ts) to keep
// the dependency direction one-way: agent-host.ts imports schemas, not the
// other way round. Keep the union in sync with agent-host.ts's AgentId type.
export type SchemaAgentId =
  | "auth"
  | "baseline-collector"
  | "keyboard-walker"
  | "visual-cross-referencer";

export const agentSchemas: Record<SchemaAgentId, z.ZodTypeAny> = {
  auth: agentOutputSchema,
  "baseline-collector": baselineAgentSchema,
  "keyboard-walker": agentOutputSchema,
  "visual-cross-referencer": agentOutputSchema,
};

export { baselineAgentSchema } from "./baseline.ts";
export {
  agentOutputSchema,
  findingSchema,
  severitySchema,
  transcriptLineSchema,
  agentSignalsSchema,
} from "./common.ts";
export type { AgentOutputParsed } from "./common.ts";
