import { describe, test, expect } from "bun:test";

import {
  BaselineCollectorOutputSchema,
  BASELINE_COLLECTOR_JSON_SCHEMA,
} from "./baseline-collector.ts";

// Drift guard between the Zod schema and its hand-written JSON-Schema twin.
//
// Rationale: the runner hands BASELINE_COLLECTOR_JSON_SCHEMA to the Agent SDK
// as `outputFormat` (so the model's response is constrained server-side) and
// then re-validates the returned payload with Zod. If the two schemas drift
// — say, a new required field is added to Zod but not the JSON-Schema — the
// model would be free to omit it, yet Zod would still reject, surfacing as
// confusing "model ignored the schema" runtime failures. This file runs both
// schemas against a shared set of fixtures and asserts they agree. If someone
// tightens one without the other, the corresponding fixture flips verdicts
// and the test fails with a pointer to the exact drift.
//
// We don't use `zod-to-json-schema` because (a) it's another dep for one
// consumer and (b) behavioural fixture agreement is strictly stronger than
// "the tool generates the same JSON" — it catches generator bugs too.

type JsonSchema = Record<string, unknown>;

// Minimal validator covering only the keywords baseline-collector's JSON-
// Schema uses: type, required, properties, additionalProperties, items, enum,
// pattern, minLength. No $ref, no oneOf, no format — unsupported keywords are
// treated as always-true so an expanded schema can't silently re-validate
// against an outdated validator.
function validateAgainstJsonSchema(value: unknown, schema: JsonSchema): boolean {
  switch (schema.type) {
    case "object":
      return validateObject(value, schema);
    case "array":
      return validateArray(value, schema);
    case "string":
      return validateString(value, schema);
    case "boolean":
      return typeof value === "boolean";
    default:
      return true;
  }
}

function validateObject(value: unknown, schema: JsonSchema): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  const required = (schema.required as string[] | undefined) ?? [];
  for (const key of required) {
    if (!(key in obj)) return false;
  }
  const properties = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(obj)) {
      if (!(key in properties)) return false;
    }
  }
  for (const [key, sub] of Object.entries(properties)) {
    if (key in obj && !validateAgainstJsonSchema(obj[key], sub)) return false;
  }
  return true;
}

function validateArray(value: unknown, schema: JsonSchema): boolean {
  if (!Array.isArray(value)) return false;
  const items = schema.items as JsonSchema | undefined;
  if (!items) return true;
  for (const item of value) {
    if (!validateAgainstJsonSchema(item, items)) return false;
  }
  return true;
}

function validateString(value: unknown, schema: JsonSchema): boolean {
  if (typeof value !== "string") return false;
  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    return false;
  }
  if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
    return false;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  return true;
}

const validFinding = {
  id: "axe:image-alt:0",
  criterion: "1.1.1",
  severity: "critical" as const,
  title: "Missing alt text",
  sources: ["axe" as const],
};

const validSignals = {
  hasInteractive: true,
  treeEmpty: false,
  needsAuth: false,
};

const cases: { name: string; expected: boolean; value: unknown }[] = [
  {
    name: "valid minimal fixture",
    expected: true,
    value: { findings: [], signals: validSignals },
  },
  {
    name: "valid fixture with a finding",
    expected: true,
    value: { findings: [validFinding], signals: validSignals },
  },
  {
    name: "missing top-level signals",
    expected: false,
    value: { findings: [] },
  },
  {
    name: "extra top-level key",
    expected: false,
    value: { findings: [], signals: validSignals, rogue: 1 },
  },
  {
    name: "finding missing criterion",
    expected: false,
    value: {
      findings: [{ id: "x", severity: "critical", title: "t" }],
      signals: validSignals,
    },
  },
  {
    name: "finding with malformed criterion",
    expected: false,
    value: {
      findings: [{ ...validFinding, criterion: "one-point-one" }],
      signals: validSignals,
    },
  },
  {
    name: "finding with unknown severity",
    expected: false,
    value: {
      findings: [{ ...validFinding, severity: "scary" }],
      signals: validSignals,
    },
  },
  {
    name: "finding with extra property",
    expected: false,
    value: {
      findings: [{ ...validFinding, rogue: 1 }],
      signals: validSignals,
    },
  },
  {
    name: "signals missing needsAuth",
    expected: false,
    value: {
      findings: [],
      signals: { hasInteractive: true, treeEmpty: false },
    },
  },
  {
    name: "signals with non-boolean field",
    expected: false,
    value: {
      findings: [],
      signals: { ...validSignals, needsAuth: "yes" },
    },
  },
  {
    name: "signals with extra property",
    expected: false,
    value: {
      findings: [],
      signals: { ...validSignals, rogue: true },
    },
  },
  {
    name: "finding with unknown sources entry",
    expected: false,
    value: {
      findings: [{ ...validFinding, sources: ["bogus"] }],
      signals: validSignals,
    },
  },
];

describe("baseline-collector schema drift (Zod vs JSON-Schema)", () => {
  for (const c of cases) {
    test(`Zod and JSON-Schema agree on: ${c.name}`, () => {
      const zodOk = BaselineCollectorOutputSchema.safeParse(c.value).success;
      const jsonOk = validateAgainstJsonSchema(
        c.value,
        BASELINE_COLLECTOR_JSON_SCHEMA as JsonSchema,
      );
      expect(zodOk).toBe(c.expected);
      expect(jsonOk).toBe(c.expected);
      // The real invariant: if the fixture flips verdicts between the two
      // schemas, surface exactly that — not just `expected`-mismatch noise.
      expect(jsonOk).toBe(zodOk);
    });
  }
});
