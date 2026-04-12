# Accessibility Audit Report: Panorama Education Homepage

## 1. Summary

| Field     | Detail                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------- |
| **URL**   | https://www.panoramaed.com/                                                                    |
| **Date**  | 2026-04-06                                                                                     |
| **Tools** | axe-core 4.11 (automated), VoiceOver + Chrome (screen reader), agent-browser (visual/keyboard) |
| **Scope** | Landing page only, single page load, no subpage crawling                                       |

---

## 2. Violations

### Critical / Serious

| #   | Criterion              | Rule                                 | Impact       | Element(s)                                                                                                                                     | Description                                                                                                                                                                             | Confidence |
| --- | ---------------------- | ------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | 4.1.2 (WCAG 2A)        | `aria-allowed-attr`                  | **Critical** | 14 elements: nav menu `<div>` items (Products, Solutions, District Stories, Resources, Company) + their `<span>` toggles + 4 tab `<div>` items | `aria-expanded` used on elements whose implicit role doesn't support it. These `<div>` and `<span>` elements lack explicit roles (like `button`) that would make `aria-expanded` valid. | High       |
| 2   | 4.1.2 (WCAG 2A)        | `aria-prohibited-attr`               | **Serious**  | 5 `<span>` dropdown toggles (`#mm-dt-1` through `#mm-dt-5`)                                                                                    | `aria-label` used on `<span>` with no valid role. Screen readers may ignore the label entirely.                                                                                         | High       |
| 3   | 2.4.4, 4.1.2 (WCAG 2A) | `link-name`                          | **Serious**  | Header logo link (`.header__logo > a`), footer logo link (`.footer__logo > a`)                                                                 | Links are in tab order but have **no accessible text**. Screen reader announces nothing meaningful. The SVG logo inside lacks `alt`/`aria-label`.                                       | High       |
| 4   | 2.4.1 (WCAG 2A)        | —                                    | **Serious**  | Page-level                                                                                                                                     | **No skip navigation link.** First Tab press does not reveal a "skip to content" link. Keyboard users must tab through the entire nav to reach content.                                 | High       |
| 5   | 1.3.1 (WCAG 2A)        | —                                    | **Serious**  | Page-level                                                                                                                                     | **No `<main>` landmark, no `<header>` landmark.** Only landmarks found are `<footer>` and multiple `<nav>` elements. Screen reader users cannot jump to the main content area.          | High       |
| 6   | 4.1.2                  | `aria-prohibited-attr` (incomplete)  | **Serious**  | 9 elements: 5 nav menu `<div>` items + 4 tab `<div>` items                                                                                     | `aria-label` on `<div>` with no valid role — label may not be announced by assistive tech.                                                                                              | High       |
| 7   | 4.1.2                  | `aria-valid-attr-value` (incomplete) | **Critical** | 9 elements: dropdown toggles + tab items                                                                                                       | `aria-controls` references IDs that could not be confirmed to exist on the page (e.g., `mm--1`, `tab__widget_...`). Relationship between control and controlled element may be broken.  | Medium     |

### Moderate

| #   | Criterion             | Rule                             | Impact       | Element(s)                                          | Description                                                                                                                                                                                                                                     | Confidence |
| --- | --------------------- | -------------------------------- | ------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 8   | 1.3.1 (best practice) | `heading-order`                  | **Moderate** | `<h4>Built for educators...`, empty `<h6>` elements | Heading hierarchy skips from `h1` directly to `h4`. No `h2` or `h3` before it. axe flagged 2 nodes; full VO walk confirms: h1 → h4 → h4 → h2 → h2 → ...                                                                                         | High       |
| 9   | Best practice         | `empty-heading`                  | **Minor**    | 4 empty `<h6>` elements inside accordion/tab items  | Headings with no text content. Screen reader announces "heading level 6" with no description.                                                                                                                                                   | High       |
| 10  | Best practice         | `landmark-unique`                | **Moderate** | Footer navigation landmarks                         | Multiple `<nav>` landmarks all labeled "Navigation Menu" — not unique. Screen reader users cannot distinguish between them.                                                                                                                     | High       |
| 11  | 1.1.1 (WCAG 2A)       | —                                | **Moderate** | Logo carousel images, resource card images          | Several images use **filenames as alt text**: "Dallas-ISD-logo-min", "EverettPublicSchoolslogo", "joco-logo", "dpscd", "DCPS", "images", "Rectangle 34-1", "ESSA_Level_II_IV_Badges_1x2_Transparent_v1". These are not meaningful descriptions. | High       |
| 12  | 4.1.2                 | —                                | **Moderate** | Tab/carousel widgets                                | Tabs announced as "X of 3" but there are 7 tab stops (slick carousel dots). The `aria-label` count is incorrect, which is misleading.                                                                                                           | High       |
| 13  | 4.1.2                 | `aria-hidden-focus` (incomplete) | **Serious**  | Slick carousel slide (`data-slick-index="2"`)       | Element has `aria-hidden="true"` but `tabindex="0"` — it's hidden from AT but still receives keyboard focus.                                                                                                                                    | High       |

### Visual / Reflow

| #   | Criterion         | Rule                          | Impact       | Description                                                                                                                                                                               | Confidence |
| --- | ----------------- | ----------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 14  | 2.4.7 (WCAG 2AA)  | —                             | **Serious**  | **No visible focus indicators** observed when tabbing through interactive elements. Screenshots during tab traversal show no outline, border, or other visual change on focused elements. | Medium     |
| 15  | 1.4.10 (WCAG 2AA) | —                             | **Moderate** | At 320px width, navigation does not collapse to a responsive/hamburger menu. Content clips and overlaps. Stats section text is cut off.                                                   | Medium     |
| 16  | 1.4.12 (WCAG 2AA) | —                             | **Moderate** | With WCAG text spacing overrides applied, testimonial card content overflows and clips on the right edge. Text is cut off.                                                                | Medium     |
| 17  | 1.4.3 (WCAG 2AA)  | `color-contrast` (incomplete) | —            | axe could not determine contrast for hero text (`<h1>` and `<p>`) due to background gradient image.                                                                                       | Low        |

---

## 3. Screen Reader Verification

**VoiceOver + Chrome on macOS**

| What was tested           | Finding                                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Page title**            | "Panorama Education \| MTSS, Surveys, and AI Platform for K-12 Districts" — descriptive and appropriate.                                                                                       |
| **Heading navigation**    | h1 → h4 → h4 → h2 → h2 → h2 → h2 → h2 → h3 (inside links) → h2. Hierarchy is broken (h1 jumps to h4). Empty h6 headings present but not surfaced in heading navigation (they have no content). |
| **Landmark navigation**   | Only footer and multiple identical "Navigation Menu" nav landmarks found. No main, no header, no banner.                                                                                       |
| **Reading order**         | Generally logical: hero → CTA → image → logo carousel → stats → content sections → resources → footer.                                                                                         |
| **Logo link**             | VoiceOver announced nothing meaningful for the header logo link — no accessible name.                                                                                                          |
| **Cookie consent dialog** | Announced as dialog with 5 items. Buttons (Accept, Deny Non-Essential, Manage Preferences) were labeled and operable.                                                                          |
| **Chatbot widget**        | Auto-appears after page load. Announced as "Nora, Panorama Virtual Assistant" but its focus behavior was not fully tested.                                                                     |
| **Tab/accordion widgets** | Announced as "Tab expander" — generic label, no indication of what content the tab controls.                                                                                                   |
| **Image alt text**        | Logo carousel images use filename-style alt text (not descriptive). Hero image "panorama-education-district-view" is a filename, not a description.                                            |

---

## 4. Passes

| Criterion              | Evidence                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------- |
| 3.1.1 Language of Page | axe passed — `<html lang="en">` present                                                 |
| 2.4.2 Page Titled      | "Panorama Education \| MTSS, Surveys, and AI Platform for K-12 Districts" — descriptive |
| 3.2.1 On Focus         | No unexpected behavior observed during tab traversal                                    |
| axe general            | 45 rules passed automated checks                                                        |

---

## 5. Confidence Levels

- **High confidence (automated + VO confirmed):** Violations #1-6, #8-13 — axe detected and/or VoiceOver directly confirmed the issue.
- **Medium confidence (tested, some interpretation):** #7 (aria-controls IDs may exist in dynamic DOM), #14 (focus indicators — screenshots don't show any, but could be very subtle), #15-16 (viewport/text spacing — tested via CSS override, not native browser zoom).
- **Low confidence:** #17 (contrast on gradient background — axe couldn't determine, and I cannot measure precise ratios from screenshots).

---

## 6. Manual Test Procedures

These are the manual checks performed beyond the automated axe-core scan. Each represents a discrete test a QA engineer could reproduce with VoiceOver (VO) and a keyboard.

### Document structure

- **Page title:** Checked the browser/VO announcement at the top level before entering web content. Verified the title is descriptive and unique.
- **Heading hierarchy:** Used VO's "next heading" command repeatedly from the top of the page to walk every heading. Recorded each heading's level and text to check for skipped levels, empty headings, and logical ordering.
- **Landmark regions:** Used VO's "next landmark" command repeatedly to enumerate all landmarks. Checked for the presence of expected landmarks (`main`, `header`/`banner`, `navigation`, `footer`) and whether each has a unique accessible name.
- **Page statistics:** Used VO's "read page stats" command to get an item count and overall page structure summary.

### Reading order

- **Sequential walk:** Starting from the top of the page, used VO's "next item" command to step through every element in DOM order. Verified the sequence matches the visual layout and makes logical sense (e.g., heading before its content, CTA after its description).

### Keyboard navigation

- **Skip navigation:** Pressed Tab once from a fresh page load to check whether the first focusable element is a "skip to main content" link.
- **Tab order:** Pressed Tab repeatedly through all interactive elements. Verified that every visible interactive element receives focus, focus moves in a logical order, and no element traps focus (can always Tab away).
- **Focus indicators:** Took a screenshot at each Tab stop to check whether a visible focus ring or highlight appears on the focused element.

### Images and alt text

- **Image walk:** Used VO's "next image" command to step through every image on the page. Listened to what VO announces for each and checked whether the alt text is meaningful (not a filename, not empty when the image conveys information, not redundant with surrounding text).
- **Cross-reference with a11y tree:** Compared the interactive accessibility tree snapshot against the visual screenshot to find images that are visible but missing from the tree, or that have mismatched names.

### Interactive widgets

- **Carousel/tabs:** Navigated to the carousel and tab widgets. Checked that role, state (`selected`, `expanded`), and count labels are announced correctly by VO. Verified keyboard operability (arrow keys, Enter/Space).
- **Cookie consent dialog:** Verified the dialog is announced as a dialog, buttons are labeled, and the dialog can be dismissed with keyboard.
- **Chatbot widget:** Noted the auto-opening chatbot and checked its initial VO announcement. (Full keyboard/focus-trap testing was not completed.)

### Visual and layout checks

- **Reflow at 320px (1.4.10):** Constrained the viewport to 320px width and took a screenshot. Checked for horizontal scrolling, content overflow, clipped text, and overlapping elements.
- **Text spacing overrides (1.4.12):** Injected WCAG-required CSS overrides (line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em, paragraph margin-bottom 2em) and took a screenshot. Checked for clipped, overlapping, or disappearing text.
- **Contrast on complex backgrounds (1.4.3):** Reviewed axe's "incomplete" contrast results for elements on gradient/image backgrounds. Took screenshots for human follow-up.

### Cross-referencing (screenshot vs. a11y tree)

- **Visible-but-unlabeled elements:** Compared the full-page screenshot against the accessibility tree snapshot. Looked for interactive elements visible in the screenshot that have no name or a generic name in the tree.
- **State mismatches:** Checked whether visual states (selected tab, expanded accordion) match what the a11y tree exposes.
- **Label accuracy:** Verified that element names in the tree match their visual labels (e.g., a button that says "Submit" visually should not say "btn-3" to AT).

---

## 7. Detection Method Breakdown

### Caught by automated testing (axe-core) alone

These issues were flagged by axe without any manual verification needed. Automated tools excel at checking DOM attributes against known rules.

| #   | Issue                                   | Why automation catches it                                                                                                                                     |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `aria-expanded` on invalid roles        | axe checks each ARIA attribute against the element's implicit/explicit role — a pure DOM rule lookup.                                                         |
| 2   | `aria-label` on roleless `<span>`       | Same mechanism: axe knows which elements support `aria-label` per the ARIA spec.                                                                              |
| 3   | Unlabeled logo links                    | axe checks every `<a>` in tab order for accessible text (visible text, `aria-label`, `aria-labelledby`, `title`, image alt). When all are empty, it flags it. |
| 6   | `aria-label` on roleless `<div>`        | Same attribute/role validation as #1 and #2.                                                                                                                  |
| 7   | `aria-controls` referencing missing IDs | axe tries to find the referenced element by ID; when it can't (possibly due to lazy rendering), it reports "incomplete."                                      |
| 8   | Heading order skip (h1 → h4)            | axe walks the heading tree and checks for level gaps.                                                                                                         |
| 9   | Empty `<h6>` headings                   | axe checks that every heading element has discernible text content.                                                                                           |
| 10  | Duplicate landmark labels               | axe verifies that landmarks of the same type have unique accessible names.                                                                                    |
| 13  | `aria-hidden` + focusable element       | axe detects the contradiction between `aria-hidden="true"` and `tabindex="0"`.                                                                                |
| 17  | Contrast undetermined on gradient       | axe attempts to compute foreground/background contrast but correctly reports "incomplete" when a background image prevents calculation.                       |

### Caught only by manual screen reader / keyboard / visual testing

These issues are **invisible to automated tools** because they require navigating the page, interpreting what gets announced, or visually inspecting rendered output. This is where ~60-70% of real accessibility barriers live.

| #   | Issue                                          | Why automation misses it                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | **No skip navigation link**                    | axe has no rule for "skip nav must exist." It can check if a skip link's `href` target exists, but it doesn't assert that a skip link _should_ be present. This was caught by tabbing from the top of the page and observing that the first focusable element was not a skip link — a purely experiential test.                                                                                           |
| 5   | **No `<main>` or `<header>` landmark**         | axe checks that existing landmarks are valid, but it does not enforce that `<main>` or `<header>` _must_ exist. This was discovered by using VoiceOver's `FIND_NEXT_LANDMARK` command and finding only `<footer>` and `<nav>` landmarks. A screen reader user trying to jump to the main content area would have no target.                                                                               |
| 11  | **Filename-style alt text on images**          | axe only checks whether alt text _exists_, not whether it's _meaningful_. "Dallas-ISD-logo-min" passes axe's check because it's a non-empty string. It took VoiceOver navigation (`FIND_NEXT_IMAGE` and reading order walk) to hear these filenames spoken aloud and recognize they convey no useful information. Automated tools fundamentally cannot judge semantic quality of text.                    |
| 12  | **Incorrect tab count ("X of 3" with 7 tabs)** | axe has no way to verify that the count in a label matches the actual number of elements. The `aria-label` is syntactically valid. This was caught by comparing the a11y tree snapshot (which showed 7 tab elements) with the labels that said "of 3" — a cross-referencing step that requires understanding the widget's intent.                                                                         |
| 14  | **Missing visible focus indicators**           | axe cannot evaluate visual rendering. It checks DOM properties, not pixels. Focus indicators are a CSS concern — `outline: none` or `outline: 0` with no replacement style. This was caught by tabbing through elements and taking screenshots at each stop, then observing that no visual change occurred on any focused element. Only a visual inspection (human or screenshot-based) can detect this.  |
| 15  | **Content overflow at 320px (reflow)**         | axe runs at whatever viewport size the browser is set to. It doesn't resize the window and re-check. Reflow testing requires changing the viewport to 320px CSS pixels (or zooming to 400%) and then visually confirming that content doesn't require horizontal scrolling. The navigation failed to collapse and content clipped — something only observable after the viewport change and a screenshot. |
| 16  | **Text clipping with spacing overrides**       | axe does not inject custom CSS and re-evaluate. WCAG 1.4.12 requires testing with specific line-height, letter-spacing, word-spacing, and paragraph spacing overrides. After injecting these via JavaScript, the testimonial cards overflowed their containers. This is a purely visual/layout test with no DOM-level signal for automation to catch.                                                     |

### Why this matters

Automated testing (axe-core) found **10 of 17 issues** on this page — a good baseline, but it missed every issue that required:

- **Navigating like a real user** (#4, #5): Does a skip link exist? Can I jump to main content? These are experiential questions about whether essential navigation affordances are present, not whether existing markup is valid.
- **Judging content quality** (#11, #12): Is the alt text meaningful? Does the label match reality? Automation checks syntax; humans check semantics.
- **Inspecting visual rendering** (#14, #15, #16): Is there a focus ring? Does content reflow? Does text clip? These are pixel-level questions that exist entirely outside the DOM.

This is why WCAG conformance testing requires both automated and manual methods. The automated pass is fast and catches the mechanical errors. The manual pass catches the issues that actually make or break a real user's experience.

---

## 8. Human Review Required

### Could not test

- **1.4.3 Contrast on gradient hero:** axe reported "incomplete" — hero h1 and body text sit on a gradient/image background. Human should verify contrast with a color picker tool.
- **1.4.11 Non-text contrast:** Button borders, form field outlines, icon contrast need manual measurement with a contrast tool.
- **1.4.13 Content on hover/focus:** Did not test tooltips on nav menu hover states or chatbot hover interactions.
- **2.5.x Pointer/touch criteria:** Not testable via keyboard/screen reader tooling.
- **Chatbot accessibility:** The auto-opening chatbot ("Nora") needs thorough testing — focus trapping, keyboard operation, ARIA live region announcements, dismissibility.
- **Multi-AT testing:** Only tested VoiceOver + Chrome. NVDA + Firefox and JAWS + Edge should also be tested.

### Tested but uncertain

- **2.4.7 Focus indicators (#14):** Screenshots showed no visible focus ring, but the browser's default outline may have been very thin or removed by CSS. Human should visually verify by tabbing through the page.
- **1.4.10 Reflow (#15):** Tested via CSS max-width constraint, not actual 400% browser zoom. Behavior may differ with native zoom.
- **1.4.12 Text spacing (#16):** Overflow observed in testimonial cards — human should verify if other sections also clip.
- **Reading order:** Appears logical but cannot verify author's intent for all sections.

### Out of scope

- Sub-pages, login flows, form submissions
- 3.2.6 Consistent Help, 3.3.7 Redundant Entry (require multi-page context)
- 3.3.8 Accessible Authentication (no login flow tested)
- Mobile/touch testing (2.5.1, 2.5.7)

---

## 9. Disclaimers

1. **Single AT/browser combination.** This audit used VoiceOver + Chrome on macOS. Results may differ with NVDA, JAWS, or other browser combinations.
2. **Automated checks are not comprehensive.** axe-core catches ~30-40% of WCAG issues. The remaining issues require human judgment.
3. **Point-in-time snapshot.** Dynamic content, the chatbot widget, and carousel state may produce different results at different times.
