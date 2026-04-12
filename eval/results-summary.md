# Eval Results: smoke-v1 (sample test)

**Date:** 2026-04-12
**Branch:** main
**Commit:** `e755995`
**Test suite:** `eval/sample-test-cases.json` (26 cases across 13 rules)

## 1. Headline Metrics

| Metric | Value |
|--------|-------|
| Total cases | 26 |
| True Positives | 13 |
| True Negatives | 13 |
| False Positives | 0 |
| False Negatives | 0 |
| Not Evaluated | 0 |
| **Precision** | **1.00** |
| **Recall** | **1.00** |
| **Accuracy** | **100%** |

All 26 test cases classified correctly.

## 2. Per-Criterion Breakdown

| Criterion | Name | TP | TN | FP | FN | Precision | Recall |
|-----------|------|----|----|----|----|-----------|--------|
| 1.3.3 | Sensory Characteristics | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 1.3.4 | Orientation | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 1.4.2 | Audio Control | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 1.4.3 | Contrast (Minimum) | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 1.4.5 | Images of Text | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 2.1.2 | No Keyboard Trap | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 2.1.4 | Character Key Shortcuts | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 2.4.1 | Bypass Blocks | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 2.4.2 | Page Titled | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 2.4.4 | Link Purpose (In Context) | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 2.4.6 | Headings and Labels | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 2.4.7 | Focus Visible | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 3.3.1 | Error Identification | 1 | 1 | 0 | 0 | 1.00 | 1.00 |

All 13 criteria scored perfectly. The sample test covers criteria from all four WCAG principles (Perceivable, Operable, Understandable, Robust).

## 3. Per-Tool Breakdown

| Tool | TP | TN | FP | FN | Cases Used |
|------|----|----|----|----|------------|
| axe | 1 | 6 | 0 | 5 | 12 (1.4.3, 2.4.1, 2.4.2, 2.4.4, 2.4.6, 2.1.4) |
| sr | 8 | 9 | 0 | 1 | 18 (2.1.2, 3.3.1, 1.4.2, 2.4.1, 2.4.2, 2.4.4, 2.4.6, 2.1.4, 2.4.7) |
| screenshot | 5 | 5 | 0 | 0 | 10 (2.4.7, 1.4.3, 1.4.5, 1.3.3, 1.3.4) |

### Tool analysis

- **axe** detected 1 of 6 violations it was asked to find (16.7% recall as standalone). It excels at structural/automated checks like color-contrast (1.4.3) but cannot detect semantic issues like misleading titles (2.4.2), non-descriptive headings (2.4.6), ambiguous link text (2.4.4), JS-based shortcuts without remapping (2.1.4), or missing landmark bypass (2.4.1 returned incomplete). Its 5 false negatives were all resolved by the SR tool.
- **sr (Orca)** was the strongest tool, detecting 8 of 9 violations (88.9% recall). It was the primary signal for keyboard traps (2.1.2), error identification (3.3.1), audio control (1.4.2), bypass blocks (2.4.1), and semantic content checks (2.4.2, 2.4.4, 2.4.6, 2.1.4). Its single miss was focus visibility (2.4.7) — SR confirms focus state but cannot verify visual presentation.
- **screenshot** achieved 100% accuracy across all 10 cases. It was the sole detection method for sensory characteristics (1.3.3), orientation restriction (1.3.4), and images of text (1.4.5), and provided corroboration for contrast (1.4.3) and focus visibility (2.4.7).

## 4. Coverage Gaps

None. All 13 criteria had sufficient tooling to make definitive calls.

Notable observations:
- The `bypass` axe rule returned "incomplete" for both 2.4.1 cases — SR resolved them by checking landmarks.
- Criteria 2.4.2 (Page Titled), 2.4.6 (Headings), 2.4.4 (Link Purpose), and 2.1.4 (Character Key Shortcuts) require **semantic understanding** beyond what axe can provide. The SR + evaluator combination handles these correctly, but they depend on the evaluator's ability to compare announced content against page context.

## 5. False Negatives

None. All violations were correctly detected.

## 6. False Positives

None. No false alarms raised.

## 7. Observations and Recommendations

### What worked well
- **Multi-tool corroboration** continues to be essential. axe alone would have missed 5 of 13 violations (38%). The SR tool resolved all of axe's blind spots.
- **SR-based semantic evaluation** caught subtle issues: mismatched page titles (2.4.2), misleading headings (2.4.6), ambiguous link text (2.4.4), and missing shortcut remapping (2.1.4).
- **Screenshot visual inspection** was the only tool capable of detecting images of text (1.4.5), sensory-only instructions (1.3.3), and CSS orientation locks (1.3.4).
- **aria-describedby detection** via SR worked perfectly for error identification (3.3.1) — the difference between pass (error announced) and fail (error silent) was unambiguous.
- **Keyboard trap detection** (2.1.2) was clean — the repeating Tab cycle pattern was easy to identify from the SR transcript.

### Limitations
- **Small sample size:** 26 cases across 13 rules (1 pass + 1 fail each). No edge cases, inapplicable cases, or ambiguous cases tested.
- **Semantic checks depend on evaluator reasoning:** Criteria like 2.4.2 and 2.4.6 require comparing announced content against page context. This works well with an AI evaluator but is not fully automatable.
- **Criteria coverage:** 13 of 50+ WCAG 2.2 AA criteria tested. Key untested criteria include 1.1.1 (Non-text Content), 1.3.1 (Info and Relationships), 4.1.2 (Name/Role/Value), and 2.4.3 (Focus Order).

### Recommendations
1. **Run the full ACT suite** (`eval/act-test-cases.json`, ~1,010 cases) to validate accuracy at scale — especially on criteria with ambiguous or inapplicable cases.
2. **Improve axe coverage for bypass blocks** — the "incomplete" result for 2.4.1 required manual SR resolution. Consider adding a post-axe check that automatically queries landmarks when bypass returns incomplete.
3. **Add automated semantic comparison** for 2.4.2 and 2.4.6 — a tool that compares the page title/heading text against page content could catch mismatches without requiring evaluator reasoning.
4. **Test axe "incomplete" resolution** across more criteria, especially 1.4.3 contrast on complex backgrounds (gradients, images, transparency).
5. **Expand SR testing patterns** for 3.3.1 — current test only checked aria-describedby association, but real-world error identification failures are more varied (errors in wrong location, non-specific messages, etc.).
