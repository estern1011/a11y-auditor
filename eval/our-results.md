# Auditor Results — Per Test Case

Each test case was evaluated using our auditor stack on the `orca-test` sprite environment:
1. **axe-core** (`bun audit.ts --port 7484`) — automated WCAG rule engine
2. **Orca screen reader** (`bun orca-driver.ts`) — real assistive technology checks

## Rule 23a2a8 — Image has non-empty accessible name (WCAG 1.1.1)

| # | Expected | axe-core Violations | Orca Observation |
|---|----------|-------------------|------------------|
| tc01 | passed | 0 WCAG violations | Orca announces page title only (image not announced separately — correct, has alt text) |
| tc02 | passed | 0 WCAG violations | Orca announces page title only |
| tc03 | passed | 0 WCAG violations | Orca announces page title only |
| tc04 | failed | `image-alt` (critical) — Images must have alternative text | Orca announces page title only (image invisible to screen reader) |
| tc05 | failed | `role-img-alt` (serious) — [role="img"] must have alt text | Orca announces page title only |
| tc06 | failed | `image-alt` (critical) — Images must have alternative text | Orca announces page title only |

## Rule 59796f — Image button has non-empty accessible name (WCAG 1.1.1)

| # | Expected | axe-core Violations | Orca Observation |
|---|----------|-------------------|------------------|
| tc07 | passed | 0 WCAG violations | Orca: "Search, push button" — correctly labeled |
| tc08 | passed | 0 WCAG violations | Orca: "Search, push button" — correctly labeled via aria-label |
| tc09 | failed | `input-image-alt` (critical) — Image buttons must have alt text | Orca: "Submit, push button" — uses name attr as fallback |
| tc10 | failed | `input-image-alt` (critical) — Image buttons must have alt text | Orca: "Submit, push button" — empty alt, no proper name |
| tc11 | failed | `input-image-alt` (critical) — Image buttons must have alt text | Orca: "Submit, push button" — broken aria-labelledby |

## Rule e086e5 — Form field has non-empty accessible name (WCAG 1.3.1)

| # | Expected | axe-core Violations | Orca Observation |
|---|----------|-------------------|------------------|
| tc12 | passed | 0 WCAG violations | Orca: "first name entry blank" — properly labeled |
| tc13 | passed | 0 WCAG violations | Orca: "last name entry blank" — aria-label works |
| tc14 | passed | 0 WCAG violations | Orca: "Country combo box England" — properly labeled |
| tc15 | failed | `label` (critical) — Form elements must have labels | Orca: "entry blank" — no label announced |
| tc16 | failed | `label` (critical) — Form elements must have labels | Orca: document only — field not discovered |
| tc17 | failed | `label` (critical) — Form elements must have labels | Orca: document only — field not discovered |

## Rule afw4f7 — Text has minimum contrast (WCAG 1.4.3)

| # | Expected | axe-core Violations | Orca Observation |
|---|----------|-------------------|------------------|
| tc18 | passed | 0 WCAG violations | Orca announces page title (contrast is visual-only, invisible to screen reader) |
| tc19 | passed | 0 WCAG violations (1 incomplete: color-contrast) | Same — axe reports incomplete (needs review) |
| tc20 | passed | 0 WCAG violations (1 incomplete: color-contrast) | Same |
| tc21 | failed | `color-contrast` (serious) — Elements must meet min contrast | Orca: page title only (cannot detect contrast) |
| tc22 | failed | 0 WCAG violations (1 incomplete: color-contrast) | **MISSED** — axe couldn't determine, flagged incomplete |
| tc23 | failed | 0 WCAG violations (1 incomplete: color-contrast) | **MISSED** — axe couldn't determine, flagged incomplete |

## Rule 047fe0 — Document has heading for non-repeated content (WCAG 2.4.1)

| # | Expected | axe-core Violations | Orca Observation |
|---|----------|-------------------|------------------|
| tc24 | passed | `html-has-lang` (unrelated to this rule) | Orca navigates headings correctly |
| tc25 | passed | `html-has-lang` (unrelated) | Orca navigates page content |
| tc26 | passed | `html-has-lang` (unrelated) | Orca finds heading 1 for main content |
| tc27 | failed | `html-has-lang` (unrelated); 1 incomplete: `bypass` | Orca: content not marked as heading — no "heading" role in speech |
| tc28 | failed | `html-has-lang` (unrelated) | **MISSED** — axe doesn't flag missing heading for non-repeated content |
| tc29 | failed | `html-has-lang` (unrelated); 1 incomplete: `bypass` | **MISSED** — same as tc28 |

**Note:** axe-core flags `html-has-lang` (WCAG 3.1.1) on these test cases because they lack a `lang` attribute, but does NOT flag the actual rule under test (heading for non-repeated content / bypass blocks). The `bypass` incomplete items are the closest, but they're flagged as "needs review" not violations.

## Rule c487ae — Link has non-empty accessible name (WCAG 2.4.4)

| # | Expected | axe-core Violations | Orca Observation |
|---|----------|-------------------|------------------|
| tc30 | passed | 0 WCAG violations | Orca: "Web Accessibility Initiative (WAI), link" — correct |
| tc31 | passed | 0 WCAG violations | Orca: "Web Accessibility Initiative (WAI), link" |
| tc32 | passed | 0 WCAG violations | Orca: "Click me for WAI!, link" |
| tc33 | failed | `link-name` (serious) — Links must have discernible text | Orca: "link" — no name |
| tc34 | failed | `link-name` (serious) — Links must have discernible text | Orca: "link" — no name |
| tc35 | failed | `link-name` (serious) — Links must have discernible text | Orca: "link" — no name |

## Rule 97a4e1 — Button has non-empty accessible name (WCAG 4.1.2)

| # | Expected | axe-core Violations | Orca Observation |
|---|----------|-------------------|------------------|
| tc36 | passed | 0 WCAG violations | Orca: "My button, push button" — correct |
| tc37 | passed | 0 WCAG violations | Orca: "Submit, push button" — correct |
| tc38 | passed | 0 WCAG violations | Orca: "My button, push button" — aria-label correct |
| tc39 | failed | `button-name` (critical) — Buttons must have discernible text | Orca: document only — empty button not announced |
| tc40 | failed | `button-name` (critical) — Buttons must have discernible text | Orca: document only — value attr not used for button name |
| tc41 | failed | `aria-command-name` (serious) — ARIA commands must have name | Orca: document only — span[role=button] without name |

## Rule 6cfa84 — aria-hidden element has no focusable content (WCAG 4.1.2)

| # | Expected | axe-core Violations | Orca Observation |
|---|----------|-------------------|------------------|
| tc42 | passed | 0 WCAG violations | Orca: document only — aria-hidden content correctly hidden |
| tc43 | passed | 0 WCAG violations | Orca: document only — content hidden |
| tc44 | failed | `aria-hidden-focus` (serious) — Hidden element must not be focusable | Orca: document only — but focusable element exists |
| tc45 | failed | `aria-hidden-focus` (serious) — Hidden element must not be focusable | Orca: "entry" — focusable input inside aria-hidden |
