import { describe, test, expect } from "bun:test";

import { BaselineCollectorOutputSchema } from "./baseline-collector.ts";

// Fixture mirrors what the auditor skill's baseline-collector agent produces
// today: a small handful of findings keyed by WCAG criterion + the three
// routing signals. Kept in sync with runner/schemas/baseline-collector.ts; if
// the schema evolves, this fixture must evolve with it.
const validFixture = {
  findings: [
    {
      id: "axe:image-alt:0",
      criterion: "1.1.1",
      severity: "critical",
      title: "<img> element without alt text",
      detail: "3 nodes",
      sources: ["axe"],
    },
    {
      id: "axe:color-contrast:4",
      criterion: "1.4.3",
      severity: "serious",
      title: "Text color contrast below 4.5:1",
      selector: ".hero h1",
    },
  ],
  signals: {
    hasInteractive: true,
    treeEmpty: false,
    needsAuth: false,
  },
};

describe("BaselineCollectorOutputSchema", () => {
  test("accepts a well-formed baseline digest", () => {
    const result = BaselineCollectorOutputSchema.safeParse(validFixture);
    expect(result.success).toBe(true);
  });

  test("accepts an empty findings array (clean page)", () => {
    const clean = { ...validFixture, findings: [] };
    const result = BaselineCollectorOutputSchema.safeParse(clean);
    expect(result.success).toBe(true);
  });

  test("rejects finding missing 'criterion'", () => {
    const bad = {
      ...validFixture,
      findings: [
        {
          id: "x",
          severity: "critical",
          title: "broken",
        },
      ],
    };
    const result = BaselineCollectorOutputSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Ensure the Zod error mentions the offending path — agent-host.ts
      // surfaces this to the caller so a bad run is inspectable.
      expect(JSON.stringify(result.error.issues)).toMatch(/criterion/);
    }
  });

  test("rejects unknown severity values", () => {
    const bad = {
      ...validFixture,
      findings: [
        {
          id: "x",
          criterion: "1.1.1",
          severity: "scary", // not in enum
          title: "bad",
        },
      ],
    };
    const result = BaselineCollectorOutputSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toMatch(/severity/);
    }
  });

  test("rejects malformed criterion strings", () => {
    const bad = {
      ...validFixture,
      findings: [
        {
          id: "x",
          criterion: "one-point-one",
          severity: "minor",
          title: "bad",
        },
      ],
    };
    const result = BaselineCollectorOutputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  test("rejects missing signal booleans", () => {
    const bad = {
      findings: [],
      signals: { hasInteractive: true, treeEmpty: false },
    };
    const result = BaselineCollectorOutputSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toMatch(/needsAuth/);
    }
  });

  test("rejects extra top-level properties (strict)", () => {
    const bad = { ...validFixture, extra: "nope" };
    const result = BaselineCollectorOutputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
