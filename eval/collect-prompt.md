## Task: Collect W3C ACT Rules Test Cases

Scrape the W3C ACT Rules repository to build a complete test case dataset
for evaluating our accessibility auditor against known ground truth.

### What are ACT Rules?

ACT (Accessibility Conformance Testing) Rules are community-reviewed test
procedures that map to WCAG success criteria. Each rule has test cases —
standalone HTML pages with known expected outcomes (pass, fail, or
inapplicable). These are the closest thing to a ground truth dataset for
automated accessibility testing.

### Step 1: Get the rule index

Go to https://www.w3.org/WAI/standards-guidelines/act/rules/ and collect
all rules that map to WCAG 2.2 Level A and AA success criteria.

For each rule, note:
- Rule ID (e.g., `23a2a8`)
- Rule name (e.g., "Image has accessible name")
- WCAG success criteria it maps to (e.g., `["1.1.1"]`)

### Step 2: Collect test cases from each rule

Visit each rule's detail page (e.g.,
https://www.w3.org/WAI/standards-guidelines/act/rules/23a2a8/proposed/).

Each page has "Passed Example N", "Failed Example N", and
"Inapplicable Example N" sections. Each example has an "Open in a new
tab" link to a standalone test case HTML page.

Collect every test case URL and its expected outcome.

### Step 3: Save as eval/act-test-cases.json

Save the complete dataset in this format:

```json
{
  "collected": "2026-04-12",
  "source": "https://www.w3.org/WAI/standards-guidelines/act/rules/",
  "rules": [
    {
      "ruleId": "23a2a8",
      "ruleName": "Image has accessible name",
      "wcagCriteria": ["1.1.1"],
      "testCases": [
        {
          "url": "https://w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/abc123.html",
          "expected": "pass",
          "description": "img element with alt attribute"
        },
        {
          "url": "https://w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/def456.html",
          "expected": "fail",
          "description": "img element without alt"
        },
        {
          "url": "https://w3.org/WAI/content-assets/wcag-act-rules/testcases/23a2a8/ghi789.html",
          "expected": "inapplicable",
          "description": "Page with no images"
        }
      ]
    }
  ]
}
```

### Requirements

- Collect ALL test cases for ALL Level A and AA rules — the goal is
  complete coverage, not a sample.
- Include inapplicable test cases — these test that our auditor correctly
  identifies when a criterion doesn't apply.
- Use the `expected` values exactly as the ACT rules define them:
  `"pass"`, `"fail"`, or `"inapplicable"`.
- The `description` field should be the test case title from the ACT
  rules page.
- Save the file to `eval/act-test-cases.json` in the repo.
- Commit the file when done.
