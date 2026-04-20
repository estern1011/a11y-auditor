import type { Finding, RunnerState, TranscriptLine } from "./state.ts";

export type AgentId =
  | "auth"
  | "baseline-collector"
  | "keyboard-walker"
  | "visual-cross-referencer";

export interface RunAgentInput {
  agentId: AgentId;
  state: RunnerState;
}

export interface AgentSignals {
  hasInteractive: boolean;
  treeEmpty: boolean;
  needsAuth: boolean;
}

export interface AgentOutput {
  findings: Finding[];
  transcript: TranscriptLine[];
  signals: AgentSignals;
}

const DEFAULT_SIGNALS: AgentSignals = {
  hasInteractive: true,
  treeEmpty: false,
  needsAuth: false,
};

// Loads `.claude/agents/<id>.md`, uses its frontmatter (tool allowlist + model)
// and body (system prompt) to configure an Agent SDK session, awaits it to
// completion, parses the structured output against a Zod schema, and returns
// findings + transcript + signals that feed conditional edges.
//
// Phase A scaffold: returns a no-op result so the graph is exercisable end-to-end
// without network calls. Real implementation lands in a follow-up that adds
// @anthropic-ai/claude-agent-sdk calls and Zod schemas under runner/schemas/.
export async function runAgent(input: RunAgentInput): Promise<AgentOutput> {
  void input;
  return {
    findings: [],
    transcript: [],
    signals: { ...DEFAULT_SIGNALS },
  };
}
