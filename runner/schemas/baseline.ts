import { agentOutputSchema } from "./common.ts";

// The baseline agent (.claude/agents/baseline-collector.md) is the first agent
// that runs real queries today, so it's the first schema to land. Shape is the
// shared agentOutputSchema — findings grouped by WCAG criterion, an SR-flavored
// transcript, and the three branch signals the runner graph depends on.
export const baselineAgentSchema = agentOutputSchema;
export type BaselineAgentOutput = import("./common.ts").AgentOutputParsed;
