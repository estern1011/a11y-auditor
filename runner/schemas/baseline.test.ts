import { describe, test, expect } from "bun:test";

import { baselineAgentSchema } from "./baseline.ts";

// Representative baseline-collector output: mirrors the auditor skill's digest
// shape translated into the runner's structured JSON contract. The values
// themselves are fabricated but the field set matches what the baseline agent
// is expected to return per its frontmatter + the common agent-output schema.
const validFixture = {
  findings: [
    {
      id: "axe:image-alt:1",
      criterion: "1.1.1",
      severity: "critical",
      title: "<img> elements without alt",
      detail: "3 <img> elements are missing accessible names.",
      sources: ["axe"],
    },
    {
      id: "axe:color-contrast:7",
      criterion: "1.4.3",
      severity: "serious",
      title: "Text below 4.5:1",
      selector: ".hero p",
      markers: [{ x: 10, y: 20, w: 300, h: 40 }],
      sources: ["axe", "visual"],
    },
  ],
  transcript: [
    { t: 1_700_000_000_000, phase: "baseline", channel: "sr", text: "heading, level 1, Hello" },
    { t: 1_700_000_000_100, phase: "baseline", channel: "tool", text: "collect.ts --out ..." },
  ],
  signals: { hasInteractive: true, treeEmpty: false, needsAuth: false },
};

describe("baselineAgentSchema", () => {
  test("accepts a realistic fixture", () => {
    const parsed = baselineAgentSchema.parse(validFixture);
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.signals.hasInteractive).toBe(true);
  });

  test("rejects findings[].criterion missing", () => {
    const bad = structuredClone(validFixture);
    // Simulate an agent that forgot to tag the WCAG SC.
    delete (bad.findings[0] as { criterion?: string }).criterion;

    const res = baselineAgentSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      const paths = res.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("findings.0.criterion");
    }
  });

  test("rejects unknown severity values loudly", () => {
    const bad = structuredClone(validFixture);
    (bad.findings[0] as { severity: string }).severity = "info";

    const res = baselineAgentSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      const msg = res.error.issues.map((i) => i.message).join(" ");
      // Zod's enum issue message names the accepted values.
      expect(msg).toMatch(/critical|serious|moderate|minor/);
    }
  });

  test("rejects missing signals", () => {
    const bad = structuredClone(validFixture) as Record<string, unknown>;
    delete bad.signals;

    const res = baselineAgentSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  test("rejects signals with non-boolean fields", () => {
    const bad = structuredClone(validFixture);
    (bad.signals as { hasInteractive: unknown }).hasInteractive = "yes";

    const res = baselineAgentSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      const paths = res.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("signals.hasInteractive");
    }
  });
});
