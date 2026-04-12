# Eval Results: smoke-v1

**Date:** 2026-04-12
**Branch:** main
**Commit:** `e755995`
**Test suite:** `eval/smoke-test-cases.json` (10 cases across 5 rules)

## 1. Headline Metrics

| Metric | Value |
|--------|-------|
| Total cases | 10 |
| True Positives | 5 |
| True Negatives | 5 |
| False Positives | 0 |
| False Negatives | 0 |
| Not Evaluated | 0 |
| **Precision** | **1.00** |
| **Recall** | **1.00** |
| **Accuracy** | **100%** |

All 10 test cases classified correctly.

## 2. Per-Criterion Breakdown

| Criterion | Name | TP | TN | FP | FN | Precision | Recall |
|-----------|------|----|----|----|----|-----------|--------|
| 1.3.3 | Sensory Characteristics | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 1.4.3 | Contrast (Minimum) | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 2.1.2 | No Keyboard Trap | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 2.4.1 | Bypass Blocks | 1 | 1 | 0 | 0 | 1.00 | 1.00 |
| 2.4.7 | Focus Visible | 1 | 1 | 0 | 0 | 1.00 | 1.00 |

All five criteria scored perfectly. No weak areas identified in this smoke test.

## 3. Per-Tool Breakdown

| Tool | TP | TN | FP | FN | Cases Used |
|------|----|----|----|----|------------|
| axe | 2 | 2 | 0 | 0 | 4 (1.4.3, 2.4.1) |
| sr | 3 | 3 | 0 | 0 | 6 (2.1.2, 2.4.1, 2.4.7) |
| screenshot | 3 | 3 | 0 | 0 | 6 (1.3.3, 1.4.3, 2.4.7) |

All three tools contributed accurate results:

- **axe** was the primary signal for contrast (1.4.3) and provided supporting evidence for bypass blocks (2.4.1), where it returned "incomplete" and SR resolved the call.
- **sr** was essential for keyboard trap detection (2.1.2), bypass block verification (2.4.1), and confirming focus state (2.4.7). It resolved axe "incomplete" results for bypass.
- **screenshot** was the sole tool for sensory characteristics (1.3.3) — a criterion requiring visual inspection of instructions. Also confirmed focus visibility (2.4.7) and contrast (1.4.3).

## 4. Coverage Gaps

None identified in the smoke test. All criteria had sufficient tooling to make definitive calls.

Notably, the `bypass` rule in axe returned "incomplete" for both 2.4.1 test cases, but the SR tool successfully resolved both by checking for landmarks, skip links, and headings.

## 5. False Negatives

None. All violations were correctly detected.

## 6. False Positives

None. No false alarms raised.

## 7. Observations and Recommendations

### What worked well
- **Multi-tool corroboration** on 2.4.1 (bypass): axe alone would have left both cases as "incomplete," but SR-based landmark/heading checks resolved them correctly.
- **Screenshot-only evaluation** for 1.3.3 (sensory characteristics) worked — visual inspection of instruction text accurately detected reliance on sensory cues.
- **SR keyboard testing** caught the keyboard trap (2.1.2) cleanly — the cyclic Tab behavior was unambiguous.

### Limitations of this run
- **Small sample size:** 10 cases across 5 rules. A clean sweep here does not guarantee accuracy on the full ACT test suite (~1,010 cases).
- **One pass + one fail per rule:** No edge cases, inapplicable cases, or ambiguous cases tested.
- **Criteria coverage:** Only 5 of 50+ WCAG 2.2 AA criteria tested. Criteria like 1.1.1 (images), 4.1.2 (name/role/value), and 1.3.1 (info/relationships) — which tend to be harder — are not represented.

### Recommendations for next steps
1. **Run the sample eval** (`eval/sample-test-cases.json`, ~26 cases) to test more criteria including 1.1.1, 1.3.1, and 4.1.2.
2. **Add sprite checkpoints** to the bootstrap process — the current cold bootstrap takes 15+ minutes due to apt-get + playwright downloads. A checkpoint-based restore would take seconds.
3. **Parallelize apt-get and bun install** in `sprite-bootstrap.sh` — they're independent.
4. **Test axe "incomplete" resolution** at scale — the bypass case showed SR can resolve incompletes, but this pattern needs validation across more criteria (especially 1.4.3 contrast incompletes on complex backgrounds).
