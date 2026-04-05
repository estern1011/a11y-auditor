# Accessibility Auditor — Design Document

## Overview

Two-layer architecture for WCAG 2.2 AA accessibility evaluation:

1. **Browse agent** — explores the app with browse, interacts with everything, invokes the auditor when it encounters new states or components
2. **Page auditor** — tests the current page state (or a scoped section), outputs structured findings

A separate **report builder** agent (future) synthesizes findings across all audited states into an ACR/VPAT.

## How It Works

The browse agent is already exploring — clicking, filling forms, opening modals, navigating pages. It knows when context has changed. At each new state, it invokes the auditor:

```bash
# browse agent exploring an app
$B goto https://app.com/dashboard
$B snapshot -i
# agent sees dashboard loaded → audit it
bun vo-driver.mjs audit                     # full page

$B click @e5                                # open settings modal
# agent sees modal appeared → audit just the modal
bun vo-driver.mjs audit ".modal-dialog"

$B goto https://app.com/settings
$B snapshot -i
$B fill @e2 ""                              # clear required field
$B click @e8                                # submit
# agent sees error state → audit the form
bun vo-driver.mjs audit "form#settings"

$B goto https://app.com/data
# agent sees a data table → audit the table specifically
bun vo-driver.mjs audit "table.data-grid"
```

The auditor doesn't navigate or interact. It reads what's on screen right now.

## Audit Command

```bash
# Full page audit
bun vo-driver.mjs audit

# Scoped to a CSS selector
bun vo-driver.mjs audit ".modal-dialog"
bun vo-driver.mjs audit "form#checkout"
bun vo-driver.mjs audit "nav.primary"

# With a URL (navigates first, then audits)
bun vo-driver.mjs audit --url https://app.com/login

# URL + scope
bun vo-driver.mjs audit --url https://app.com/settings "form#profile"
```

### What `audit` does

1. **If `--url` given:** navigate to it, wait for load
2. **Run axe-core** scoped to selector (or full page)
   - Returns violations, passes, incomplete, inapplicable
3. **Enter web content** automatically (GO_TO_BEGINNING → find web content → START_INTERACTING)
4. **If selector given:** navigate VoiceOver to that element
5. **Walk the scoped area with VoiceOver:**
   - All headings (level + text + what VO announces)
   - All landmarks
   - All images (check what VO announces — meaningful alt or "unlabeled image"?)
   - All form controls (labels announced?)
   - All links (text announced?)
   - All buttons (labels announced?)
   - Reading order (first ~30 items via snapshot)
6. **Output structured JSON**

### Output Format

```json
{
  "url": "https://app.com/dashboard",
  "selector": ".modal-dialog",
  "timestamp": "2026-04-05T12:00:00Z",
  "axe": {
    "violations": [
      {
        "id": "image-alt",
        "impact": "critical",
        "wcag": ["1.1.1"],
        "description": "Images must have alternate text",
        "nodes": [
          { "selector": "img.avatar", "html": "<img class=\"avatar\" src=\"...\">" }
        ]
      }
    ],
    "incomplete": [
      {
        "id": "color-contrast",
        "impact": "serious",
        "wcag": ["1.4.3"],
        "description": "Elements must meet minimum color contrast ratio thresholds",
        "nodes": [{ "selector": ".muted-text" }]
      }
    ],
    "passes": 42,
    "inapplicable": 18
  },
  "voiceover": {
    "headings": [
      { "level": 1, "text": "Dashboard", "announced": "heading level 1 Dashboard" },
      { "level": 3, "text": "Recent", "announced": "heading level 3 Recent", "issue": "skipped h2" }
    ],
    "landmarks": [],
    "images": [
      { "announced": "Unlabeled image", "issue": "missing alt text" },
      { "announced": "User avatar, image", "issue": null }
    ],
    "formControls": [
      { "announced": "Search, search text field", "issue": null },
      { "announced": "edit text", "issue": "no label" }
    ],
    "links": [
      { "announced": "Settings, link", "issue": null },
      { "announced": "link", "issue": "empty link text" }
    ],
    "buttons": [
      { "announced": "Submit, button", "issue": null },
      { "announced": "button", "issue": "no label" }
    ],
    "readingOrder": [
      "heading level 1 Dashboard",
      "Search, search text field",
      "heading level 3 Recent",
      "..."
    ]
  }
}
```

## What the Browse Agent Does With This

The browse agent receives the JSON and reasons about it:

- **axe violations** → direct issues, cite WCAG criterion and suggest fixes
- **axe incomplete** → agent judges (is this alt text meaningful? is this contrast sufficient in context?)
- **VoiceOver headings** → agent judges hierarchy and label quality
- **VoiceOver "unlabeled image"** → definite issue
- **VoiceOver "edit text" with no label** → definite issue
- **VoiceOver reading order** → agent judges coherence
- **Missing landmarks** → agent notes based on page structure

The agent also does things the audit command can't:
- Opens the modal and audits it → then closes it and checks focus returns
- Fills the form and submits → then audits the error state
- Compares the pre/post state: "did submitting the form trigger a live region announcement?"

These interactive tests are done by the browse agent orchestrating both browse (for interaction) and vo-driver (for reading the result).

## What to Build

### Phase 1: PoC
1. **`audit` command in vo-driver** — runs axe + VoiceOver walk, outputs JSON
2. **Auto-enter web content** — the start/audit commands handle the GO_TO_BEGINNING/next/next/START_INTERACTING dance automatically
3. **axe-core integration** — add `@axe-core/playwright` as a dependency, inject into page

### Phase 2: Integration
4. **Selector scoping** — axe scoped via `.include()`, VO navigated to element
5. **Attach to browse's browser** — `--cdp` flag to share Playwright session

### Phase 3: Reporting
6. **Report builder agent skill** — takes audit JSONs, produces ACR/VPAT
7. **VPAT 2.5 template** — standard ITI format

## Architecture

```
Browse agent (exploring the app)
  │
  │  encounters new state/component
  │
  ├─── $B snapshot -i          (sees the visual state)
  │
  ├─── bun vo-driver.mjs audit ".modal"
  │      │
  │      ├── axe-core (scoped to .modal)
  │      ├── VoiceOver walk (headings, controls, images...)
  │      └── → structured JSON
  │
  │  agent reasons about findings
  │  agent interacts further (close modal, check focus)
  │  agent moves on to next state
  │
  ▼
Findings accumulated across all states
  │
  ▼
Report builder agent → ACR/VPAT
```
