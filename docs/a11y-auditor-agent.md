# Accessibility Auditor — Design Document

## Overview

Two-agent architecture for WCAG 2.2 AA accessibility evaluation:

1. **Page auditor** — tests a single URL, outputs structured findings
2. **Report builder** — takes findings from multiple page auditors, produces the ACR/VPAT

This document covers the page auditor. The report builder is a separate concern.

## Page Auditor

### Input

```json
{
  "url": "https://app.com/dashboard",
  "scope": "#main",              // optional: CSS selector to scope audit
  "voiceover": true,             // optional: run Phase 3 (requires macOS + display)
  "flows": [                     // optional: interaction sequences to test
    { "name": "search", "steps": ["focus search input", "type query", "submit", "verify results"] }
  ]
}
```

In practice, the orchestrating agent spawns the page auditor subagent with a prompt like:
"Audit https://app.com/dashboard for WCAG 2.2 AA. Focus on the main content area. Test the search flow. VoiceOver is available."

### Output

Structured findings per WCAG criterion:

```json
{
  "url": "https://app.com/dashboard",
  "timestamp": "2026-04-05T12:00:00Z",
  "criteria": {
    "1.1.1": {
      "name": "Non-text Content",
      "level": "A",
      "conformance": "partially_supports",
      "findings": [
        {
          "type": "violation",
          "severity": "serious",
          "source": "axe",
          "element": "img.hero-banner",
          "description": "Image alt text is the filename: 'hero-v2.jpg'",
          "impact": "Screen reader user cannot understand the image purpose",
          "suggestion": "Replace with descriptive alt text"
        },
        {
          "type": "pass",
          "source": "axe",
          "description": "14 of 15 images have appropriate alt text"
        }
      ]
    },
    "1.3.1": {
      "name": "Info and Relationships",
      "level": "A",
      "conformance": "does_not_support",
      "findings": [...]
    },
    ...
  },
  "evidence": {
    "screenshots": ["/tmp/audit/dashboard.png"],
    "voiceover_transcript": [...],
    "axe_results": { "violations": 8, "passes": 47, "incomplete": 3 }
  }
}
```

### Three Phases

#### Phase 1: Automated checks (axe-core via browse)

Run axe against the page. One call, structured results.

```bash
$B goto <url>
$B eval "await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag22aa']).analyze()"
```

Or if using vo-driver's Playwright instance, inject axe-core and run it.

axe returns:
- **violations** — definite failures (map directly to findings)
- **passes** — confirmed passing checks
- **incomplete** — axe couldn't determine; needs human/agent review → feed into Phase 2
- **inapplicable** — criteria that don't apply to this page content

This covers ~60 WCAG rules automatically.

#### Phase 2: Accessibility tree reasoning (browse)

The agent reads the a11y tree and reasons about things axe can't judge.

```bash
$B snapshot             # full tree
$B snapshot -s "#main"  # scoped
$B screenshot /tmp/audit/page.png
```

The agent reviews:

**axe's "incomplete" items first** — these are axe saying "I found something but need a human to judge." The agent IS that human. Example: axe flags an image with alt text but can't judge if the alt text is meaningful. The agent reads the alt text, looks at the page context, and decides.

**Then broader reasoning:**
- Alt text quality: descriptive or just filename/placeholder?
- Heading text: meaningful section labels or generic ("Section 1")?
- Reading order: does the tree sequence make sense for the page's visual layout?
- ARIA correctness: are custom widgets using the right patterns for their type?
- Link text: clear purpose or vague ("click here", "learn more")?
- Information conveyed only visually: errors shown only by color, required shown only by asterisk?

**Evidence:** The agent takes a screenshot and saves the tree snapshot for the report.

#### Phase 3: VoiceOver interactive testing (vo-driver)

Only runs when VoiceOver is available (macOS with display). Tests things that can't be determined from static analysis.

```bash
bun vo-driver.mjs start <url>
# agent enters web content and explores
bun vo-driver.mjs stop
```

**What to test:**

Custom widget operation:
- Navigate to the widget with VoiceOver
- Is the role announced? ("combobox", "tab", "dialog" — not just "group")
- Is the state announced? ("expanded", "selected", "checked")
- Operate it with keyboard (arrows, Enter, Space, Escape)
- Does VoiceOver announce the state change?

Focus management:
- Open a modal → VO announces "dialog"? Focus moves inside?
- Tab within modal → focus trapped?
- Close modal → focus returns to trigger?
- SPA navigation → new content announced?

Live regions:
- Submit a form → success/error announced?
- Add to cart → status announced?
- Loading state → announced?

Form flow:
- Tab through fields → each label announced?
- Submit with empty required fields → errors announced? Which field?
- Error messages associated with inputs?

**Evidence:** The agent records what VoiceOver announced at each step as a transcript.

### Criteria the agent assesses

Every WCAG 2.2 AA criterion gets a conformance level. Here's how each phase contributes:

| Criterion | Phase 1 (axe) | Phase 2 (tree reasoning) | Phase 3 (VoiceOver) |
|-----------|---------------|--------------------------|---------------------|
| 1.1.1 Non-text Content | Missing alt, empty alt on functional images | Alt text quality, SVG descriptions | What VO actually announces for images |
| 1.2.x Time-based Media | Detects video/audio presence | Checks for captions/transcripts | N/A |
| 1.3.1 Info and Relationships | Heading gaps, missing labels, table headers | Heading meaningfulness, list usage, ARIA patterns | VO announces correct roles/relationships? |
| 1.3.2 Meaningful Sequence | DOM order vs visual order | Reading order coherence | VO reading order makes sense? |
| 1.3.4 Orientation | Viewport meta | N/A | N/A |
| 1.3.5 Identify Input Purpose | autocomplete attributes | N/A | N/A |
| 1.4.1 Use of Color | N/A | Agent looks at screenshots for color-only info | N/A |
| 1.4.3 Contrast | Color contrast ratios | N/A | N/A |
| 1.4.4 Resize Text | N/A | Test at 200% zoom via viewport | N/A |
| 1.4.10 Reflow | N/A | Test at 320px wide | N/A |
| 1.4.11 Non-text Contrast | UI component contrast | N/A | N/A |
| 1.4.12 Text Spacing | N/A | Apply text spacing overrides, check for clipping | N/A |
| 1.4.13 Content on Hover | N/A | Hover tooltips dismissable, hoverable, persistent? | N/A |
| 2.1.1 Keyboard | Tab through page | All interactive elements reachable? | All elements reachable and operable via VO? |
| 2.1.2 No Keyboard Trap | Tab through all components | Focus stuck anywhere? | VO cursor stuck anywhere? |
| 2.4.1 Bypass Blocks | Skip link present | Skip link works | VO can use skip link |
| 2.4.2 Page Titled | Empty/missing title | Title descriptive? | VO announces title on load |
| 2.4.3 Focus Order | Tab order matches visual | Logical sequence? | N/A |
| 2.4.4 Link Purpose | Empty links, ambiguous text | Link text meaningful in context? | VO announces clear link purpose? |
| 2.4.6 Headings and Labels | Present/absent | Descriptive? | VO announces meaningful headings? |
| 2.4.7 Focus Visible | Focus styles present | Adequate visibility? | N/A (visual) |
| 2.4.11 Focus Not Obscured | N/A | Sticky headers covering focused elements? | N/A |
| 2.5.x Input Modalities | Touch target size (44x44) | N/A | N/A |
| 3.1.1 Language of Page | lang attribute | Correct language? | N/A |
| 3.1.2 Language of Parts | lang on foreign-language content | N/A | N/A |
| 3.2.1 On Focus | N/A | Focus causes unexpected changes? | N/A |
| 3.2.2 On Input | N/A | Input causes unexpected changes? | N/A |
| 3.3.1 Error Identification | N/A | Errors described in text? | Errors announced by VO? |
| 3.3.2 Labels or Instructions | Input labels present | Labels clear and helpful? | VO announces labels? |
| 3.3.3 Error Suggestion | N/A | Suggestions provided? | Suggestions announced? |
| 3.3.4 Error Prevention | N/A | Reversible/confirmed/reviewed? | N/A |
| 4.1.2 Name, Role, Value | Missing names/roles | Correct for widget type? | VO announces correct name/role/state? |
| 4.1.3 Status Messages | aria-live present | Appropriate politeness? | Actually announced by VO? |

### Conformance levels

For each criterion, the agent assigns:

- **supports** — fully meets the criterion (evidence: all axe checks pass, tree looks correct, VO confirms)
- **partially_supports** — some instances pass, some fail (explain which)
- **does_not_support** — fails the criterion (explain how)
- **not_applicable** — the criterion doesn't apply (no video = skip 1.2.x)
- **not_evaluated** — couldn't test (no VoiceOver available for Phase 3 items, note this)

## What to Build

### In vo-driver:
1. **Auto-enter web content** — `start` should navigate past browser chrome and into web content automatically
2. **`eval` endpoint** — run JS in the page (for axe-core injection if not using browse)

### Skill docs:
3. **Page auditor skill** — the agent persona + instructions for the three-phase audit
4. **Report builder skill** — instructions for synthesizing multi-page findings into ACR/VPAT

### Templates:
5. **VPAT 2.5 template** — the actual ITI format with all WCAG 2.2 AA criteria rows

### Optional:
6. **Automated check scripts** — pre-built JS for Phase 1 if not using axe (lighter weight, but axe is better)
7. **axe integration** — add `@axe-core/playwright` as a dependency, expose via endpoint
