---
name: acr
description: |
  Generate an Accessibility Conformance Report (ACR) in VPAT 2.5 format from audit findings. Use this skill after completing an accessibility audit to produce a formal ACR document mapping findings to WCAG 2.2 Level A and AA success criteria. Also trigger when the user mentions ACR, VPAT, conformance report, or wants to formalize audit results into a standards-compliant deliverable.
---

# ACR Generator — VPAT 2.5 WCAG 2.2 Edition

You generate Accessibility Conformance Reports from audit findings. An ACR is a completed VPAT (Voluntary Product Accessibility Template) — the standard format used in procurement, compliance, and legal contexts to document how a product conforms to accessibility standards.

## Input

You need audit findings. These come from one of:

1. **A just-completed audit in this conversation** — findings from the auditor skill (axe-core results, screen reader transcripts, screenshots, manual observations)
2. **A saved audit report file** — a markdown report from a prior audit session
3. **Raw axe-core JSON output** — automated results only (the ACR will have many "Not Evaluated" entries)

If no audit has been performed, tell the user to run an audit first using the `/auditor` skill.

## Process

### Step 1: Load the Criteria Mapping

Read `skills/acr/criteria.json` to get the full WCAG 2.2 Level A + AA criteria list with axe rule mappings and test methods.

### Step 2: Collect All Evidence

Gather every finding from the audit:

- **axe-core violations** — each has WCAG SC tags, impact level, affected elements
- **axe-core passes** — rules that passed confirm conformance for those criteria
- **axe-core incomplete** — items that need manual review
- **Screen reader findings** — what VoiceOver/Orca announced, navigation behavior, state changes
- **Visual observations** — from screenshots (focus indicators, color use, reflow, text spacing)
- **Manual checks** — keyboard navigation, form error handling, reading order

### Step 3: Map Findings to Criteria

For each of the 55 WCAG 2.2 A+AA criteria in criteria.json:

1. **Check the `testTools` array** — this tells you which tools apply: `"axe"` (automated), `"sr"` (screen reader + keyboard), `"screenshot"` (visual + DOM/CSS inspection).
2. **For each tool in `testTools`**, check whether the audit produced relevant findings. Use the per-tool instructions in `testMethod`.
3. **If `testTools` is empty**, the criterion requires multi-page testing or input modalities we can't test — assign "Not Evaluated" and cite the `note` field.
4. **Assign a conformance level:**

| Conformance Level      | When to Use                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| **Supports**           | All related axe rules pass AND SR/manual testing confirms conformance. No known defects. |
| **Partially Supports** | Some functionality meets the criterion but there are specific failures.                  |
| **Does Not Support**   | Majority of relevant functionality fails.                                                |
| **Not Applicable**     | The criterion is not relevant to this product (e.g., no video content → 1.2.x N/A).      |
| **Not Evaluated**      | The criterion was not tested. Be honest — this is better than a false "Supports".        |

**Rules for assigning conformance levels:**

- If axe found violations for a criterion but the scope is limited (e.g., 2 of 50 images missing alt text), that's "Partially Supports", not "Does Not Support"
- If `testTools` includes multiple tools, axe passes alone are NOT sufficient for "Supports" — you need confirmation from the other listed tools (sr, screenshot) too
- If `testTools` is `["axe"]` only and all related axe rules pass, you can assign "Supports"
- If a criterion was not tested by any of its listed tools, assign "Not Evaluated" — never guess
- If `testTools` is `[]`, assign "Not Evaluated" and cite the `note` field explaining why
- When in doubt between two levels, choose the less favorable one

### Step 4: Write the Remarks

The "Remarks and Explanations" column is where the value lives. For each criterion:

- **Supports**: Brief evidence. "All images have descriptive alt text. Verified by axe-core (0 violations for image-alt, role-img-alt) and screen reader navigation (all images announced with meaningful descriptions)."
- **Partially Supports**: What works, what doesn't, and where. "Most form fields are labeled. 3 fields in the checkout flow (phone, zip, CVV) lack associated labels — screen reader announces them as 'edit text' with no description."
- **Does Not Support**: What's broken and the impact. "Custom dropdown menus use div/span with click handlers. No ARIA roles, keyboard operation, or focus management. Screen reader cannot interact with these controls."
- **Not Applicable**: Why. "No prerecorded video content on the audited pages."
- **Not Evaluated**: What would be needed. "Requires testing across multiple pages to verify consistent navigation order. Only one page was audited."

**Remarks must cite evidence:**

- axe rule IDs and violation counts
- Screen reader transcript excerpts (quote the announcement)
- Screenshot observations (describe what you saw)
- Specific pages/components affected

### Step 5: Generate the ACR

Produce the report in the template format below. Fill in every field.

## Output Format

Generate the ACR as a markdown file. Use this exact structure:

```markdown
# [Product Name] Accessibility Conformance Report

**VPAT Version:** 2.5 WCAG Edition
**Product Name:** [Name]
**Product Version:** [Version or URL]
**Report Date:** [Month Year]
**Product Description:** [Brief description]
**Contact Information:** [Contact for accessibility questions]
**Notes:** [Any relevant notes about scope, methodology]
**Evaluation Methods Used:** [List tools and methods — e.g., axe-core 4.x, VoiceOver + Chrome on macOS (or Orca + Chromium on Linux), manual keyboard testing, visual inspection]

## Applicable Standards/Guidelines

| Standard/Guideline | Included in Report |
| ------------------ | ------------------ |
| WCAG 2.2 Level A   | Yes                |
| WCAG 2.2 Level AA  | Yes                |
| WCAG 2.2 Level AAA | No                 |

## Terms

| Term               | Definition                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Supports           | The functionality of the product has at least one method that meets the criterion without known defects or meets with equivalent facilitation. |
| Partially Supports | Some functionality of the product does not meet the criterion.                                                                                 |
| Does Not Support   | The majority of product functionality does not meet the criterion.                                                                             |
| Not Applicable     | The criterion is not relevant to the product.                                                                                                  |
| Not Evaluated      | The product has not been evaluated against the criterion. This can only be used in WCAG Level AAA criteria.                                    |

## WCAG 2.2 Report

### Table 1: Level A

| Criteria                                                                               | Conformance Level | Remarks and Explanations |
| -------------------------------------------------------------------------------------- | ----------------- | ------------------------ |
| [1.1.1 Non-text Content](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content) | [level]           | [remarks]                |
| ...                                                                                    | ...               | ...                      |

### Table 2: Level AA

| Criteria                                                                           | Conformance Level | Remarks and Explanations |
| ---------------------------------------------------------------------------------- | ----------------- | ------------------------ |
| [1.2.4 Captions (Live)](https://www.w3.org/WAI/WCAG22/Understanding/captions-live) | [level]           | [remarks]                |
| ...                                                                                | ...               | ...                      |

## Summary

**Overall Conformance:** [X of Y criteria Support, X Partially Support, X Do Not Support, X Not Applicable, X Not Evaluated]

**Key Strengths:**

- [What the product does well]

**Key Issues:**

- [Critical barriers, ordered by impact]

**Recommendations:**

- [Prioritized fixes]

## Limitations and Caveats

1. **Single AT/browser combination.** This report is based on testing with [VoiceOver/Orca] + Chrome on [macOS/Linux]. Results may differ with NVDA, JAWS, or other browser combinations.
2. **Automated checks are not comprehensive.** axe-core catches approximately 30-40% of WCAG issues. Criteria marked "Supports" based solely on automated testing may have undetected issues.
3. **Point-in-time snapshot.** This report reflects the state of the product at the time of testing. Dynamic content, updates, and server-side changes may produce different results.
4. **Pages tested:** [List specific URLs/flows audited]
```

## Diffing ACRs

When the user has a previous ACR for the same product, generate a diff summary:

```markdown
## Changes Since Last Report ([Previous Date])

| Criteria                | Previous           | Current            | Change    |
| ----------------------- | ------------------ | ------------------ | --------- |
| 1.1.1 Non-text Content  | Partially Supports | Supports           | Improved  |
| 2.4.7 Focus Visible     | Does Not Support   | Partially Supports | Improved  |
| 4.1.2 Name, Role, Value | Supports           | Partially Supports | Regressed |

**Improvements:** X criteria improved
**Regressions:** X criteria regressed
**Net change:** [+/-X criteria now conformant]
```

## JSON Output

When the user requests JSON (or for programmatic use), also output a machine-readable version:

```json
{
  "product": "...",
  "version": "...",
  "date": "2026-04-12",
  "standard": "WCAG 2.2",
  "levels": ["A", "AA"],
  "evaluationMethods": ["axe-core 4.x", "screen reader + Chrome", "manual"],
  "criteria": [
    {
      "id": "1.1.1",
      "name": "Non-text Content",
      "level": "A",
      "conformance": "Partially Supports",
      "remarks": "...",
      "evidence": {
        "axeViolations": 3,
        "axePasses": 47,
        "srVerified": true,
        "manualChecked": true
      }
    }
  ],
  "summary": {
    "supports": 30,
    "partiallySupports": 12,
    "doesNotSupport": 3,
    "notApplicable": 5,
    "notEvaluated": 5
  }
}
```

## Important Reminders

- **Never inflate conformance.** A false "Supports" is worse than "Not Evaluated". Procurement teams rely on ACRs for purchasing decisions.
- **Cite evidence for every claim.** A conformance level without remarks is useless.
- **Distinguish automated from manual findings.** "Supports (automated only)" is weaker than "Supports (automated + SR verified)".
- **Flag criteria that need multi-page testing.** Single-page audits cannot fully evaluate 3.2.3 Consistent Navigation, 3.2.4 Consistent Identification, 3.2.6 Consistent Help, or 2.4.5 Multiple Ways.
- **The ACR is a formal document.** Use precise, professional language. Avoid hedging ("seems to work") — either it meets the criterion or it doesn't, or you didn't test it.
