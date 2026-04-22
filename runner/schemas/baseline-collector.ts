import { z } from "zod";

// Structured output contract for the baseline-collector agent.
//
// The agent returns two things:
//   - `findings` — one entry per axe violation / resolved-incomplete / URL drift
//     it wants the orchestrator to track. Matches the runtime `Finding` shape
//     in runner/state.ts — we duplicate the fields here (rather than reusing
//     the state type) because this schema is the wire contract the agent must
//     satisfy, and the runtime type can drift independently (e.g. adding UI-
//     only fields without forcing the agent to produce them).
//   - `signals` — the three boolean signals the conditional edges in graph.ts
//     branch on. `hasInteractive` + `treeEmpty` feed baseline's outgoing edge;
//     `needsAuth` is surfaced here so the agent can flag paywall/login drift
//     it detected after discover already ran, even if this slice doesn't route
//     back to auth on it yet.
//
// The JSON-Schema twin below is handed to the Agent SDK as `outputFormat` so
// the model returns structured output the SDK places in `result.structured_output`.
// Zod then re-validates before we push into state — if the model ignores the
// schema, `safeParse` fails loudly (see runner/agent-host.ts) so silent empty
// findings never make it into the report. Hand-written duplicate rather than
// auto-generated because zod-to-json-schema is an extra dep for three files;
// baseline-collector-drift.test.ts guards against the two schemas drifting
// out of sync by running both against a shared fixture set and asserting
// verdict agreement on every case.

const FindingSchema = z
  .object({
    id: z.string().min(1),
    criterion: z.string().regex(/^\d+\.\d+\.\d+$/, {
      message: "criterion must look like '1.3.1', '2.4.7', etc.",
    }),
    severity: z.enum(["critical", "serious", "moderate", "minor"]),
    title: z.string().min(1),
    detail: z.string().optional(),
    selector: z.string().optional(),
    screenshot: z.string().optional(),
    sources: z
      .array(z.enum(["axe", "sr", "keyboard", "visual", "manual"]))
      .optional(),
  })
  .strict();

export const BaselineCollectorOutputSchema = z
  .object({
    findings: z.array(FindingSchema),
    signals: z
      .object({
        hasInteractive: z.boolean(),
        treeEmpty: z.boolean(),
        needsAuth: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type BaselineCollectorOutput = z.infer<typeof BaselineCollectorOutputSchema>;

export const BASELINE_COLLECTOR_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "signals"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "criterion", "severity", "title"],
        properties: {
          id: { type: "string", minLength: 1 },
          criterion: {
            type: "string",
            pattern: "^\\d+\\.\\d+\\.\\d+$",
          },
          severity: {
            type: "string",
            enum: ["critical", "serious", "moderate", "minor"],
          },
          title: { type: "string", minLength: 1 },
          detail: { type: "string" },
          selector: { type: "string" },
          screenshot: { type: "string" },
          sources: {
            type: "array",
            items: {
              type: "string",
              enum: ["axe", "sr", "keyboard", "visual", "manual"],
            },
          },
        },
      },
    },
    signals: {
      type: "object",
      additionalProperties: false,
      required: ["hasInteractive", "treeEmpty", "needsAuth"],
      properties: {
        hasInteractive: { type: "boolean" },
        treeEmpty: { type: "boolean" },
        needsAuth: { type: "boolean" },
      },
    },
  },
};
