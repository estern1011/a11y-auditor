## Task: Update ACT Rules Test Cases

Refresh the test cases dataset from the W3C's official JSON endpoint.

### Source

The W3C publishes all ACT test cases as a single JSON file:
https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases.json

### Steps

1. Download the JSON file
2. Filter to test cases that map to WCAG 2.2 Level A or AA criteria
   (look for keys like `wcag20:1.1.1`, `wcag21:1.4.10`, `wcag22:2.4.11`
   in `ruleAccessibilityRequirements`)
3. Group by rule and save as `eval/act-test-cases.json` in this format:

```json
{
  "collected": "YYYY-MM-DD",
  "source": "https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases.json",
  "rules": [
    {
      "ruleId": "23a2a8",
      "ruleName": "Image has non-empty accessible name",
      "wcagCriteria": ["1.1.1"],
      "testCases": [
        {
          "url": "https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/hash.html",
          "expected": "passed",
          "description": "Passed Example 1"
        }
      ]
    }
  ]
}
```

4. Commit the updated file.

### Notes

- The expected values from the W3C are `"passed"`, `"failed"`, and
  `"inapplicable"` (not `"pass"`/`"fail"`).
- This only needs to be re-run when the W3C updates their test cases.
  The current dataset has ~1,000 test cases across ~70 rules.
