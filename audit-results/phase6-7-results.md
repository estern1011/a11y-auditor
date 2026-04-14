# WCAG 2.2 AA Audit — Phase 6 & 7 Results
**Site:** https://dequeuniversity.com/demo/mars/  
**Date:** 2026-04-14  
**Tool:** Orca (Linux screen reader) + Chromium via CDP + axe-core 4.11  
**Phases covered:** Phase 6 (Visual + Cross-Reference Review) and Phase 7 (Remaining Criteria Checklist)

---

## Phase 6: Visual + Cross-Reference Review

### Step 1: Evidence Gathered

- Full-page screenshot taken at 1280×1024 viewport (saved `/tmp/screenshot_full.png`)
- Accessibility tree snapshot obtained via `agent-browser --cdp 9223 snapshot -i`
- axe-core audit run via `bun audit.ts --port 7484`

---

### Step 2: Screenshot vs. A11y Tree Cross-Reference

#### Observations

**Elements present visually but missing or misrepresented in the tree:**

1. **Home/Logo link (icon-menu-home)**: Visually shows the MarsCommuter® logo as a clickable icon. In the a11y tree it appears as `link [ref=e21]` with no name. The HTML is `<a href="demo/mars/#" title="MarsCommuter®"><i class="icon-logo"></i></a>`. The `title` attribute provides a tooltip text but axe reports this link has insufficient accessible text because `title` alone on an icon link is fragile. The visual label "MarsCommuter®" is not exposed correctly.

2. **Calendar trigger button**: Visually shows a calendar icon button. HTML: `<button class="ui-datepicker-trigger"><img src="calendar.png" alt="..." title="..."></button>`. The `alt` text is literally `"..."` — not meaningful. The tree shows `button "..."` — a non-descriptive label. **FAIL (1.1.1, 4.1.2)**

3. **Carousel deals section**: Visually shows a rotating carousel of special offers. There is no `role`, `aria-label`, or `aria-live` on the carousel container `<div class="carousel">`. Screen readers will not be notified of auto-updating carousel content. The a11y tree exposes it as generic list items. **FAIL (4.1.3 — status messages; also relevant to 1.3.1)**

4. **"icecream.jpg " alt text on space-station.jpg image**: The image `space-station.jpg` has `alt="icecream.jpg "` — the alt text is a filename, not a description. Orca reads this as "icecream.jpg image link". Visual context shows a space station image in the "Free Astronaut Ice Cream" promotion. The alt text is a filename artifact, not meaningful. **FAIL (1.1.1)**

5. **"Beautiful baboon, blowing bubbles, biking backward" alt text on mars-sunrise.jpg**: The image `mars-sunrise.jpg` shows a Martian sunrise. The alt text "Beautiful baboon, blowing bubbles, biking backward" is intentionally incorrect/nonsensical (demo error). Orca reads: "Beautiful baboon, blowing bubbles, biking backward image link". **FAIL (1.1.1)**

6. **Search input**: Visually labeled by a search icon. In the form there is no `<label>`, no `aria-label`, no `aria-labelledby`, no `title`. Only a `placeholder="search"` which is not an accessible label. The a11y tree shows `textbox "search"` (from placeholder). **FAIL (1.3.1, 4.1.2)**

7. **Time selector (`#time0`)**: Visually implied by its context (departure time) but has no associated `<label>` element and no ARIA label. The tree shows `combobox [expanded=false]` with no name. **FAIL (1.3.1, 4.1.2)**

8. **Traveler type selector (`#traveler0`)**: Visually preceded by the text "Traveler" in a `<span class="traveler-label">` but this is not programmatically associated. No `<label>`, no `aria-labelledby`. The tree shows `combobox [expanded=false]` with no accessible name. **FAIL (1.3.1, 4.1.2)**

9. **Radio groups without group labels**: Three groups of radio buttons lack `<fieldset>`/`<legend>` or equivalent `role="group"` + `aria-labelledby` grouping:
   - "Find Fares & Schedules / MarsCommuter Passes / MarsCommuter Reservations / Find Activities / Book a Hotel" — no group label in tree
   - "One-Way / Round-Trip / Multi-Planet" — no group label
   - "Yes / No" (for MarsElite Pass question) — no group label
   The tree shows these as individual radios with no group context. **FAIL (1.3.1)**

10. **Duplicate IDs in deals carousel**: The carousel shows the same 7 deals repeated three times. The headings and links have duplicated text. In the a11y tree these appear as repeated items (e.g., three sets of "10% off Crater Adventure" links). This may confuse AT users. **ISSUE (2.4.6)**

11. **Elements correctly represented in tree**:
    - H1 "Destination Mars" — present in tree ✓
    - H2 tagline — present in tree ✓
    - Navigation links (Add a trip, Find a pass, etc.) — present with correct text ✓
    - Footer links — present with correct text ✓
    - Form fields (From, To, Departure Date) — present with correct labels ✓
    - Iframe "NASA: Life on Mars Was a Possibility" — present with title in tree ✓
    - Twitter Follow Button iframe — present with title ✓

---

### Step 3: Focus Indicator Testing

Tab order was traversed from page beginning. Results:

| Tab Stop | Element | Focus Indicator CSS | Visible Focus? |
|----------|---------|--------------------|--------------------|
| 1 | Sign In link | `outline: rgb(16,16,16) auto 1px` | Yes — thin browser default outline |
| 2 | My Cart $0.00 link | `outline: rgb(16,16,16) auto 1px` | Yes — thin browser default |
| 3 | MarsCommuter® link | `outline: rgb(16,16,16) auto 1px` | Yes — thin browser default |
| 4 | Travel Agents link | `outline: rgb(16,16,16) auto 1px` | Yes — thin browser default |
| 5 | Your country link | `outline: rgb(16,16,16) auto 1px` | Yes — thin browser default |
| 6 | Your language link | `outline: rgb(16,16,16) auto 1px` | Yes — thin browser default |
| 7 | Home icon link (no name) | `outline: rgb(16,16,16) auto 1px` | Yes — outline present but 1px |
| 8 | Send me to Mars! link | `outline: rgb(16,16,16) auto 1px` | Yes — thin browser default |
| 9 | Hotels link | `outline: rgb(16,16,16) auto 1px` | Yes — thin browser default |
| 10 | Things to Do link | `outline: rgb(16,16,16) auto 1px` | Yes — thin browser default |

**Focus indicator notes:**
- All tested interactive elements show a browser-default outline of `1px auto`. Under WCAG 2.2 SC 2.4.11 (Focus Appearance, AA), a minimum focus indicator area of the perimeter of the unfocused component × 2 CSS pixels is required. A `1px auto` outline is marginal and may fail the enhanced focus criterion on some elements depending on their perimeter size.
- Search `<input type="text">` when focused shows `outline: none` (outline-style: none, outline-width: 0px) — **no visible focus indicator**. Only a box-shadow provides subtle styling. This is a **FAIL for WCAG 2.4.7** (Focus Visible).
- Radio buttons use the default browser `outline: auto 5px` — visible.
- `<select>` elements use `outline: auto 5px` — visible.

**WCAG 2.4.7 violation**: The search text input has `outline: none` on focus. No visible focus indicator is provided.

---

### Step 4: Reflow at 320px (WCAG 1.4.10)

**Method**: Attempted viewport resize to 320px. The page uses a fixed-width layout with no responsive CSS media queries.

**Findings**:
- The page has a fluid-looking container (`container-fluid-full`) but its computed width is 1265px at 1280px viewport — it does not respond to narrow viewports.
- There are **zero CSS media queries** with `max-width` or `min-width` breakpoints in the loaded stylesheets.
- Fixed-width elements detected: `<html>` 1265px, `<body>` 1265px, `#control-panel` 1265px, `#left-column` 962px, nav elements at 450–500px.
- The meta viewport tag is `width=device-width` only — no initial-scale set.
- At 320px viewport, the page would require horizontal scrolling because the fixed-width layout at 1265px cannot reflow to fit 320px without scrolling.

**VERDICT: FAIL — WCAG 1.4.10 Reflow.** The page has a fixed-width layout with no responsive breakpoints. At 320px CSS width (equivalent to 1280px viewport at 400% zoom), the content would require 2D scrolling.

---

### Step 5: Text Spacing (WCAG 1.4.12)

Text spacing overrides applied:
- `line-height: 1.5`
- `letter-spacing: 0.12em`
- `word-spacing: 0.16em`
- paragraph `margin-bottom: 2em`

**Findings**:
- No elements with `overflow: hidden` showed `scrollWidth > clientWidth` after applying the overrides.
- No text clipping, overlapping, or loss of content detected via computed style checks.
- Screenshot (`/tmp/text_spacing.png`) captured showing text with increased spacing.
- No elements with `max-height` clipping issues detected.

**VERDICT: PASS — WCAG 1.4.12 Text Spacing.** Content remains visible and functional with WCAG-required text spacing overrides.

---

### Step 6: Content on Hover/Focus (WCAG 1.4.13)

**Tooltip element found**: `<a data-tooltip="tooltip" data-title="<strong>Get a reservation for your MarsElite Pass</strong>...">MarsElite Pass</a>`

- The element uses a Bootstrap-style `data-tooltip` attribute to trigger tooltip content stored in `data-title`.
- The tooltip content itself is not accessible as a separate `role="tooltip"` element — no `role="tooltip"` element appears in the DOM even after hover.
- Hovering over the element (`agent-browser hover "a[data-tooltip]"`) did not cause a visually-distinct tooltip element to appear in the DOM.
- No `role="tooltip"` elements found before or after hovering.
- The tooltip data is in `data-title` attribute and may be rendered by a JavaScript tooltip library but no rendered tooltip was found in the DOM during testing.

**VERDICT**: The MarsElite Pass tooltip content stored in `data-title` is not exposed to assistive technology as a tooltip. If the tooltip renders dynamically via JavaScript, it needs `role="tooltip"` and must be dismissible, hoverable, and persistent per WCAG 1.4.13. **Needs further investigation / likely FAIL (1.4.13).**

**Other hover-revealed content**: No other tooltip or hover-triggered content was found on the page.

---

## Phase 7: Remaining Criteria Checklist

### 7.1 — 1.1.1 Non-text Content

**Orca image scan results:**

| Image file | Alt text (Orca reads) | Issue |
|-----------|----------------------|-------|
| `mars-spaceman.jpg` (×3) | "mars2 Unlabeled image" | **FAIL** — `alt` attribute missing entirely |
| `space-station.jpg` (×3) | "icecream.jpg image link" | **FAIL** — alt text is a filename, not meaningful |
| `mars-lander.jpg` (×3) | "Mars Lander image link" | Pass — descriptive |
| `kids-space.jpg` (×3) | "Kids in space suits image link" | Pass (minor trailing space) |
| `wookie.jpg` (×3) | "Wookie image link" | Pass |
| `global-free-days.jpg` (×3) | "Martian sunrise." image link | **FAIL** — alt text does not match visual content (shows a planet/radio-themed image in "Get Radio on Uranus" context) |
| `mars-sunrise.jpg` (×3) | "Beautiful baboon, blowing bubbles, biking backward image link" | **FAIL** — alt text is intentionally incorrect/nonsensical |
| `calendar.png` (×3) | Read from `title="..."` — "..." | **FAIL** — alt text is literally "..." (meaningless) |
| `gplus-32.png` | "Google+" | Pass |
| Tracking pixel (`seg`, 1×1) | No alt | **FAIL** — tracking pixel without `alt=""` |
| Tracking pixel (1×1, two others) | alt="" | Pass — marked decorative |
| Thumbnail-image | "thumbnail-image" | **FAIL** — alt text is the CSS class name, not descriptive |

**Summary for 1.1.1**: **FAIL**. Multiple images have missing alt text, filename alt text, or nonsensical alt text.

**axe violations confirming image issues:**
- `image-alt` (critical): `img[src$="seg"]` (no alt), `mars-spaceman.jpg` linked images (no alt on ×3 instances)
- `link-name` (serious): 3 image links pointing to `mars2.html?a=crater_adventure` have images with no alt text, making the link purpose indeterminate

---

### 7.2 — 2.4.1 Bypass Blocks

**Test**: Navigated to page beginning with Orca, checked first interactive element.

**Result**: First Orca navigation item was: `"clickable. This web page is for demonstration purposes..."` (a disclaimer div), followed by navigation with "Add a trip / Find a pass" links.

**No skip navigation link found.**

JavaScript search for `<a href="#...">` links returned zero results. Text search for "skip" or "jump" anchor text returned zero results.

**VERDICT: FAIL — WCAG 2.4.1 Bypass Blocks.** There is no skip navigation or skip to main content mechanism. Users who navigate by keyboard must Tab through the entire navigation header (approximately 20+ interactive elements) before reaching the main content.

---

### 7.3 — 2.4.2 Page Titled

**Page title**: `"Mars Commuter: Travel to Mars for Work or Pleasure!"`

**Assessment**: The title is descriptive and identifies both the site name ("Mars Commuter") and the purpose ("Travel to Mars"). It does not uniquely identify the current page (it is the same for all Mars demo pages) but is functional for the homepage.

**VERDICT: PASS — WCAG 2.4.2 Page Titled.**

---

### 7.4 — 2.4.4 Link Purpose

**Links scanned via Orca FIND_NEXT_LINK** and JavaScript analysis:

**Issues found:**

1. **Home icon link** (`<a href="demo/mars/#" title="MarsCommuter®">`): No text, no `aria-label`. Title attribute alone does not reliably provide an accessible name. Orca cannot announce a meaningful purpose. **FAIL**

2. **Three crater adventure image links** (`<a href="mars2.html?a=crater_adventure"><img src="mars-spaceman.jpg"></a>`): Image has no `alt` text and the link has no accessible text. Orca announces: "mars2 Unlabeled image" — link purpose is unintelligible. **FAIL**

3. **Empty link** (`<a href="mars2.html?a="></a>`): No text content, no image, no ARIA label. **FAIL**

4. **Video fader links** (three `<a class="fader">` elements): These are YouTube video selector links with no text content. Announced by Orca as empty. **FAIL**

5. **"MarsMobile app" link** (`<a href="mars2.html?a=">MarsMobile app</a>`): The link text "MarsMobile app" is borderline — it is readable but points to an empty anchor `a=`. Minimal concern.

6. **Link text mismatches**: Several links in the a11y tree had descriptive text when combined with their context heading (e.g., "Book your MarStar Crater Package today to save!" is clear in context). Most text links pass 2.4.4.

**Links that pass**: "Add a trip", "Find a pass", "Sign In", "Hotels", "Things to Do", "Mars Map", "Rockets", "Be Bold...", "Countdown...", "Blast Off!", "Why MarsCommuter?", footer links, etc.

**VERDICT: FAIL — WCAG 2.4.4 Link Purpose.** Multiple links have no accessible name (image links without alt text, empty links, icon links).

**axe violations confirming link issues:**
- `link-name` (serious): 8 instances — home icon link, 3 crater adventure image links, empty `a[href="mars2.html?a="]`, and 3 video fader links.

---

### 7.5 — 3.1.1 Language of Page

**HTML element lang attribute**: Not present. `document.documentElement.lang` returns empty string.

**axe violation**: `html-has-lang` (serious, wcag311): The `<html>` element has no `lang` attribute.

**VERDICT: FAIL — WCAG 3.1.1 Language of Page.** The `<html>` element is missing the `lang` attribute. Screen readers cannot determine the language to use for pronunciation.

---

### 7.6 — 3.2.1 On Focus

**Test**: Tabbed through 10 interactive elements while monitoring for unexpected context changes. Also checked for `onfocus`/`onblur` inline event handlers.

**Results**:
- No `onfocus` or `onblur` inline event handlers found on any element.
- Focusing the first radio button did not change URL or page context.
- No dialogs, page reloads, or context changes triggered by focus alone.
- The autocomplete inputs (`#from0`, `#to0`) have `aria-haspopup="true"` and `aria-autocomplete="list"` — they likely show dropdown suggestions on typing, not on focus alone.

**VERDICT: PASS — WCAG 3.2.1 On Focus.** No unexpected context changes occur when elements receive focus.

---

### 7.7 — 3.2.2 On Input

**Test**: Changed select values and triggered `change` events programmatically.

**Results**:
- `#time0` (departure time select): Changing value did not trigger navigation or context change. Pass.
- `#passes-select`: Changing value did not trigger navigation. Pass.
- `#selCountry1` (has `onchange="setSelects(this.form, 1)"`): The `setSelects()` function is a cascading dropdown handler — it populates dependent country selects. This is expected behavior (dependent dropdowns for multi-planet routes). No unexpected navigation occurs. **Borderline pass** — the cascade is expected for dependent selects, but the behavior is not announced to AT users.
- No select element triggers form submission or page navigation on change.
- No page URL changed after any input interaction tested.

**VERDICT: PASS — WCAG 3.2.2 On Input.** No unexpected context changes occur when form values are changed.

---

## Summary of Issues Found

### Critical WCAG 2.2 AA Failures

| SC | Criterion | Severity | Issue |
|----|-----------|----------|-------|
| 1.1.1 | Non-text Content | Critical | `mars-spaceman.jpg` (×3) missing alt; `space-station.jpg` (×3) has filename as alt; `mars-sunrise.jpg` (×3) has nonsensical alt; `calendar.png` (×3) has `alt="..."` |
| 1.3.1 | Info & Relationships | Serious | Search input, time select, traveler select have no label association; radio groups lack group labels (`<legend>` or `role="group"`) |
| 1.4.7 | Focus Visible | Serious | Search text input has `outline: none` — no visible focus indicator |
| 1.4.10 | Reflow | Serious | Fixed-width layout (1265px) with no responsive media queries — requires horizontal scrolling at 320px/400% zoom |
| 2.4.1 | Bypass Blocks | Serious | No skip navigation link present |
| 2.4.4 | Link Purpose | Serious | 8 links with no accessible text: home icon link, 3 crater adventure image links, empty link, 3 video fader links |
| 3.1.1 | Language of Page | Serious | `<html>` element missing `lang` attribute |
| 4.1.2 | Name, Role, Value | Critical | Calendar trigger button `alt="..."` — button has no accessible name; time select and traveler select unlabeled |

### Additional Issues (from axe audit)

| SC | Criterion | Severity | Issue |
|----|-----------|----------|-------|
| 1.3.1 / 4.1.2 | aria-prohibited-attr | Serious | YouTube player `<div id="movie_player">` has `aria-label` without a valid role |
| 1.4.3 | Color Contrast | Serious | 6 confirmed failures: "Be Bold..." h3 (4.31:1, needs 4.5:1), "Countdown..." h3 (1.87:1), "Blast Off!" h3 (2.83:1), 3 body text elements (4.49:1) |
| 1.4.1 | Use of Color | Serious | Link "prepare your last will and testament" — insufficient contrast with surrounding text (1.17:1) and no underline styling |
| 4.1.2 | Frame title | Serious | Facebook iframe missing accessible title |
| 4.1.2 | Select name | Critical | `#time0` (departure time) and `#traveler0` (traveler type) selects have no accessible name |
| Best Practice | Tabindex | Serious | `#from0`, `#to0`, `#deptDate0`, `#time0` use `tabindex > 0`, disrupting natural tab order |
| Best Practice | Landmark unique | Moderate | Two `<nav>` landmarks with identical accessible names |
| Best Practice | Region | Moderate | Large sections of page content not contained by landmark regions |

### Potential Issues Needing Investigation

| SC | Issue |
|----|-------|
| 1.4.13 | MarsElite Pass tooltip: `data-title` tooltip content not confirmed as accessible; no `role="tooltip"` found in DOM; FAIL if tooltip is invisible to AT |
| 2.4.6 | Deals carousel: 7 offers repeated 3 times each — users may be confused; no `aria-label` on carousel to clarify |
| 4.1.3 | Auto-rotating carousel has no `aria-live` region — updates not announced |

### Passing Criteria (Phase 7)

| SC | Criterion | Result |
|----|-----------|--------|
| 2.4.2 | Page Titled | PASS — "Mars Commuter: Travel to Mars for Work or Pleasure!" |
| 1.4.12 | Text Spacing | PASS — No content loss when WCAG text spacing overrides applied |
| 3.2.1 | On Focus | PASS — No context changes on focus |
| 3.2.2 | On Input | PASS — No unexpected context changes on input |

---

## Raw Evidence

### axe Violations Summary (from `bun audit.ts --port 7484`)
- `aria-prohibited-attr` (serious): YouTube player div uses aria-label without valid role
- `button-name` (critical): `.ui-datepicker-trigger` button has no accessible name
- `color-contrast` (serious): 6 confirmed failures (see table above)
- `frame-title` (serious): Facebook iframe `#fafbba78` has no title
- `html-has-lang` (serious): `<html>` missing lang attribute
- `image-alt` (critical): `img[src$="seg"]` (tracking pixel) and 3× `mars-spaceman.jpg` images missing alt
- `link-in-text-block` (serious): "prepare your last will and testament" link
- `link-name` (serious): 8 links with no accessible text
- `select-name` (critical): `#time0` and `#traveler0` selects unlabeled
- `tabindex` (best practice): 4 elements with `tabindex > 0`

### Orca Screen Reader Image Readings
```
Image 1: "mars2 Unlabeled image"         — mars-spaceman.jpg, no alt
Image 2: "icecream.jpg image link"        — space-station.jpg, filename as alt
Image 3: "Mars Lander image link"         — mars-lander.jpg, OK
Image 4: "Kids in space suits image link" — kids-space.jpg, OK
Image 5: "Wookie image link"              — wookie.jpg, OK
Image 6: "Martian sunrise. image link"    — global-free-days.jpg, wrong context
Image 7: "Beautiful baboon, blowing bubbles, biking backward image link" — mars-sunrise.jpg, wrong
Image 8: (repeat cycle)
Image 13: "... Unlabeled image"           — calendar.png, alt="..."
Image 14: "thumbnail-image image"         — CSS class used as alt
Image 15: "Google+ image link"            — gplus-32.png, OK
```

### Focus Indicator Check (CSS)
```
Links:         outline: rgb(16,16,16) auto 1px  — browser default, thin
Search input:  outline: rgb(85,85,85) none 0px   — NO OUTLINE (FAIL 2.4.7)
Radio buttons: outline: rgb(16,16,16) auto 5px  — browser default, adequate
Select:        outline: rgb(16,16,16) auto 5px  — browser default, adequate
```

### Page Title
```
document.title = "Mars Commuter: Travel to Mars for Work or Pleasure!"
```

### Language Attribute
```
document.documentElement.lang = "" (absent — FAIL 3.1.1)
```
