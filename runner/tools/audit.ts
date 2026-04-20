import type { Finding } from "../state.ts";

export interface AuditInput {
  url: string;
  driverPort: number;
  tags?: string[];
}

export interface AuditToolResult {
  findings: Finding[];
  axePassCount: number;
}

// Wraps audit.ts. Phase A scaffold.
export async function runAudit(input: AuditInput): Promise<AuditToolResult> {
  void input;
  return {
    findings: [],
    axePassCount: 0,
  };
}
