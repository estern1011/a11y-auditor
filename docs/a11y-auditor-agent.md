# Accessibility Auditor Agent — Design Document

## What This Is

An agent persona that performs WCAG 2.2 AA accessibility audits by combining:
1. **Accessibility tree analysis** — reading the computed a11y tree and reasoning about it (works everywhere)
2. **Automated DOM checks** — programmatic queries for known-bad patterns (works everywhere)
3. **VoiceOver interactive testing** — operating the page as a screen reader user to test dynamic behavior (macOS with display only)

Existing skills (wshobson's screen-reader-testing, webflow's accessibility-audit, etc.) are reference docs — they tell the agent what to look for. This agent actually **does** the looking, using browse and vo-driver as its hands.

## Architecture

```
┌─────────────────────────────────────────────────┐
│              a11y auditor agent                  │
│                                                  │
│  Input:  URL(s), scope, report format            │
│  Output: structured findings + conformance table │
│                                                  │
│  Phase 1: Automated checks (browse)              │
│  Phase 2: Tree reasoning (browse snapshot)       │
│  Phase 3: Interactive testing (vo-driver)         │
│  Phase 4: Report generation                      │
└──────────┬──────────────────┬────────────────────┘
           │                  │
     ┌─────▼─────┐    ┌──────▼──────┐
     │  browse    │    │  vo-driver  │
     │  (any OS)  │    │  (macOS)    │
     │            │    │             │
     │ • snapshot │    │ • next/prev │
     │ • eval JS  │    │ • perform   │
     │ • screenshot│   │ • press     │
     │ • interact │    │ • snapshot  │
     └────────────┘    └─────────────┘
```

## Phase 1: Automated Checks (browse)

These are programmatic — run JS against the DOM, get structured results. Fast, deterministic, covers the "automated 30-50%" of issues.

```bash
$B goto <url>
$B eval "(() => { ... })"   # run check scripts
```

### Checks to automate:

**1.1.1 Non-text Content**
- `img` without `alt`
- `img` with `alt=""` that is NOT decorative (has click handler, is inside link/button)
- `svg` without `aria-label` or `<title>`
- `input[type=image]` without `alt`
- `[role=img]` without `aria-label`

**1.3.1 Info and Relationships**
- Heading hierarchy gaps (h1→h3 skipping h2)
- No `<h1>` on page
- `<table>` without `<th>` (data tables)
- `<input>` without associated `<label>` (via `for`/`id` or wrapping)
- Radio/checkbox groups without `<fieldset>`/`<legend>`
- Lists of items not using `<ul>`/`<ol>`

**1.3.1 Landmarks**
- No `<main>` landmark
- No `<nav>` for navigation areas
- Multiple same-type landmarks without unique labels
- Content not contained in any landmark

**1.4.3 Contrast (Minimum)**
- Compute contrast ratios for text elements (need computed colors)

**2.4.1 Bypass Blocks**
- No skip link as first focusable element

**2.4.2 Page Titled**
- Empty or generic `<title>`

**2.4.4 Link Purpose**
- Links with text "click here", "read more", "here", "learn more"
- Links with no text content (empty `<a>`)
- Links containing only an image with no alt

**4.1.2 Name, Role, Value**
- `<div>` or `<span>` with click handlers but no `role` or `tabindex`
- Custom elements missing ARIA roles
- Interactive elements without accessible names

**Output:** JSON array of findings, each with WCAG criterion, severity, element selector, what's wrong, suggested fix.

## Phase 2: Tree Reasoning (browse)

The agent reads the accessibility tree and **thinks** about it. This is where the AI adds value over automated tools.

```bash
$B snapshot          # full a11y tree
$B snapshot -s "nav" # scoped to section
```

The agent reads the tree and reasons about:

- **Is this alt text meaningful?** "hero-banner-v2.jpg" passes automated check but is useless. "A diverse group of coworkers collaborating around a laptop" is good. "Image" is bad.
- **Does the reading order make sense?** The tree shows the order elements will be read. Does it flow logically? Does sidebar content interrupt main content?
- **Are these headings actually describing sections?** "Section 1", "Details", "Info" are technically present but meaningless.
- **Is this ARIA pattern correct for the widget type?** A custom combobox has `role="combobox"` but is it using `aria-activedescendant` correctly? Is `aria-expanded` toggling?
- **Is important visual information conveyed non-visually?** Error states shown only by color, required fields shown only by asterisk, status shown only by icon.

**Output:** Agent's assessment for each WCAG criterion it can evaluate from the tree, with reasoning.

## Phase 3: Interactive Testing (vo-driver)

The agent operates VoiceOver to test things that can't be determined from static analysis. This is the "last mile" — the 20% that only a real screen reader catches.

```bash
bun vo-driver.mjs start <url>
# ... agent explores ...
bun vo-driver.mjs stop
```

### What to test interactively:

**Custom widget operation**
- Tab to widget → does VoiceOver announce its role and state?
- Operate it (arrow keys, Enter, Space) → does VoiceOver announce the change?
- Compare what VoiceOver says vs what ARIA attributes say it should say

**Focus management**
- Open modal → does VO announce "dialog"? Does focus move inside?
- Tab through modal → does focus stay trapped?
- Close modal → does focus return?
- SPA navigation → is new content announced?

**Live regions**
- Trigger an action (form submit, add to cart) → is the status announced?
- Trigger an error → is it announced assertively?
- Loading states → announced?

**Form flow**
- Tab through all fields → does VO announce each label?
- Submit with errors → does VO announce which fields have errors?
- Required fields → announced as required?

**Reading experience**
- Walk through page with `next` → is the experience coherent?
- Are decorative elements properly hidden?
- Is there content that's visually present but skipped by VO (or vice versa)?

**Output:** Agent's findings from interactive testing, with what VoiceOver announced vs what was expected.

## Phase 4: Report Generation

### Format Option A: QA Issue List

For dogfooding/QA, a flat list of issues:

```markdown
## Accessibility Issues: https://app.com/dashboard

### Critical
1. **Missing form labels** — 3 inputs in the search form have no associated labels.
   VO announces: "edit text" with no indication of purpose.
   WCAG: 1.3.1, 4.1.2
   Fix: Add `<label>` elements or `aria-label` attributes.

2. **Keyboard trap in date picker** — Tab enters the date picker but cannot exit.
   VO announces: stuck cycling through date cells.
   WCAG: 2.1.2
   Fix: Add Escape key handler to close picker and return focus.

### Serious
3. **Heading hierarchy skip** — h1 "Dashboard" → h3 "Recent Activity" (no h2)
   WCAG: 1.3.1
   ...

### Moderate
...

### Passing
- Skip link present and functional
- All images have meaningful alt text
- Landmarks properly defined (nav, main, footer)
```

### Format Option B: ACR/VPAT Table

For formal accessibility conformance reporting:

```markdown
# Voluntary Product Accessibility Template (VPAT)
# Based on WCAG 2.2 Level AA

| Criteria | Conformance Level | Remarks |
|----------|------------------|---------|
| **1.1.1 Non-text Content** | Partially Supports | 12 of 15 images have appropriate alt text. 3 decorative images in the footer expose filenames to screen readers (missing alt=""). |
| **1.2.1 Audio-only and Video-only** | Not Applicable | No audio or video content present. |
| **1.3.1 Info and Relationships** | Does Not Support | Heading hierarchy skips levels in 3 sections. Search form inputs lack programmatic labels. Navigation uses div-based layout without landmark roles. |
| **1.3.2 Meaningful Sequence** | Supports | Reading order matches visual layout. Tab order is logical. |
| **1.3.3 Sensory Characteristics** | Supports | Instructions do not rely solely on shape, color, or position. |
| ... | ... | ... |
```

Conformance levels:
- **Supports** — fully meets the criterion
- **Partially Supports** — some aspects meet, some don't (explain)
- **Does Not Support** — fails the criterion (explain)
- **Not Applicable** — criterion doesn't apply to this content
- **Not Evaluated** — wasn't tested

### Evidence

Each finding should include:
- What was tested (URL, component, interaction)
- What was observed (VoiceOver announcement, DOM state, screenshot)
- What was expected
- WCAG criterion and level
- Severity (critical/serious/moderate for QA; conformance level for ACR)

## Agent Persona

The auditor agent should be instructed roughly as:

```
You are an accessibility auditor performing a WCAG 2.2 AA conformance evaluation.

You have two tools:
- browse: headless browser for screenshots, DOM inspection, JS evaluation, and
  reading the accessibility tree. Use this for automated checks and tree analysis.
- vo-driver: VoiceOver screen reader for interactive testing. Use this to verify
  how the page actually behaves with assistive technology.

Your workflow:
1. Navigate to the target URL with browse
2. Run automated DOM checks (Phase 1)
3. Read and reason about the accessibility tree (Phase 2)
4. If vo-driver is available, perform interactive testing (Phase 3)
5. Compile findings into [QA list / ACR table] format

For each WCAG criterion:
- State whether it passes, partially passes, fails, or is not applicable
- Provide specific evidence (what you observed)
- For failures, describe the impact on users and suggest a fix

Be thorough but efficient. Don't test criteria that clearly don't apply (no video
on page = skip 1.2.x). Focus interactive testing on custom widgets, forms, and
dynamic content where automated checks can't reach.
```

## What We Need to Build

1. **vo-driver auto-enter** — `start` should land inside web content automatically, not at browser chrome
2. **Automated check scripts** — JS snippets for Phase 1 that return structured JSON (can be run via browse's `eval` or vo-driver adding an `eval` endpoint)
3. **The agent persona/skill doc** — instructions for the auditor agent
4. **Report templates** — QA issue list and ACR/VPAT table formats

What we DON'T need to build:
- A new CLI tool — browse + vo-driver are the tools
- A fixed audit script — the agent IS the audit logic
- Integration between browse and vo-driver — they're used sequentially on the same URL
