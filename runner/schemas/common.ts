import { z } from "zod";

// Severity values mirror runner/state.ts Severity. Unknown severities must fail
// Zod validation (not silently coerce) so a misbehaving agent surfaces loudly.
export const severitySchema = z.enum(["critical", "serious", "moderate", "minor"]);

export const findingSchema = z.object({
  id: z.string().min(1),
  criterion: z.string().min(1),
  severity: severitySchema,
  title: z.string().min(1),
  detail: z.string().optional(),
  selector: z.string().optional(),
  screenshot: z.string().optional(),
  markers: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
      }),
    )
    .optional(),
  sources: z.array(z.enum(["axe", "sr", "keyboard", "visual", "manual"])).optional(),
});

export const transcriptLineSchema = z.object({
  t: z.number(),
  phase: z.enum(["boot", "discover", "auth", "baseline", "keyboard", "visual", "report"]),
  channel: z.enum(["sr", "key", "tool", "agent", "system"]),
  text: z.string(),
});

export const agentSignalsSchema = z.object({
  hasInteractive: z.boolean(),
  treeEmpty: z.boolean(),
  needsAuth: z.boolean(),
});

export const agentOutputSchema = z.object({
  findings: z.array(findingSchema),
  transcript: z.array(transcriptLineSchema),
  signals: agentSignalsSchema,
});

export type AgentOutputParsed = z.infer<typeof agentOutputSchema>;
