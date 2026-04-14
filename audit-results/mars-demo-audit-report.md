# Accessibility Audit Report: Mars Commuter Demo

## 1. Summary

| Field | Detail |
|-------|--------|
| **Page URL** | https://dequeuniversity.com/demo/mars/ |
| **Date** | 2026-04-14 |
| **Tools Used** | axe-core (via audit.ts), Orca screen reader (Linux), agent-browser (CDP snapshots/screenshots), Chromium |
| **Scope** | Single-page audit of the Mars Commuter homepage — all visible content, forms, navigation, carousel, embedded video, and footer |
| **Environment** | 3 parallel sprite VMs (Linux), Orca screen reader + Chromium for Testing |
| **Standard** | WCAG 2.2 Level AA |

**Note:** This is a known demo page designed by Deque University to showcase common accessibility errors.

---

## 2. Violations

### 2.1 Automated Violations (axe-core)

| # | Criterion | Rule ID | Impact | Element(s) | Description |
|---|-----------|---------|--------|------------|-------------|
| 1 | 3.1.1 Language of Page | `html-has-lang` | Serious | `<html>` | The `<html>` element does not have a `lang` attribute. Screen readers cannot determine the correct pronunciation. |
| 2 | 1.1.1 Non-text Content | `image-alt` | Critical | 4 images (spaceman images, tracking pixel) | Images missing `alt` attribute entirely. Screen reader announces "Unlabeled image" or filename. |
| 3 | 4.1.2 Name, Role, Value | `link-name` | Serious | 8 links (home icon, carousel image links, video fader controls) | Links with no accessible name — announced as blank "link" by screen reader. Includes `link [ref=e21]`, `link [ref=e98]`, `link [ref=e112]`, `link [ref=e126]`. |
| 4 | 4.1.2 Name, Role, Value | `button-name` | Critical | 1 button (calendar datepicker trigger `ref=e203`) | Button has no accessible name — announced as just "button" by Orca. |
| 5 | 4.1.2 Name, Role, Value | `select-name` | Critical | 2 `<select>` elements (departure time, traveler type) | Dropdowns have no associated label. Time select announced as "combo box" with no name; traveler type announced as "combo box Adult (26+)" with no label. |
| 6 | 1.4.3 Contrast (Minimum) | `color-contrast` | Serious | 6 elements | Insufficient text contrast ratios. Worst offender: "Countdown..." heading at 1.87:1 (requires 4.5:1). |
| 7 | 4.1.2 Name, Role, Value | `frame-title` | Serious | 1 iframe (Facebook Like Box, `ref=e143`) | Iframe has no `title` attribute — screen reader cannot identify its purpose. |
| 8 | 1.4.1 Use of Color | `link-in-text-block` | Serious | 1 link ("prepare your last will and testament") | Link is indistinguishable from surrounding text by color alone (contrast between link and text: 1.17:1). No underline or other non-color indicator. |
| 9 | 4.1.2 Name, Role, Value | `aria-prohibited-attr` | Serious | 1 element (YouTube iframe `<div>`) | Uses `aria-label` on an element whose role does not permit it. |

### 2.2 Automated Violations (Best Practice)

| # | Rule ID | Impact | Element(s) | Description |
|---|---------|--------|------------|-------------|
| 10 | `tabindex` | Serious | 4 form fields | Positive `tabindex` values (1, 3, 4) disrupt natural tab order. Tab sequence starts at carousel/form instead of top of page. |
| 11 | `region` | Moderate | 42 elements | Large portions of page content are outside any ARIA landmark region. No `<main>` landmark exists. |
| 12 | `landmark-unique` | Moderate | 1 duplicate | Multiple `<nav>` elements without unique labels — screen reader users cannot distinguish between them. |

### 2.3 Incomplete (Needs Manual Review)

| # | Rule ID | Impact | Element(s) | Description |
|---|---------|--------|------------|-------------|
| 13 | `color-contrast` | Serious | 87 elements | Background color could not be determined (gradients/images behind text). |
| 14 | `duplicate-id-aria` | Critical | `<select id="age0">` | Element ID referenced multiple times via ARIA — may cause incorrect label association. |
| 15 | `link-in-text-block` | Serious | 3 footer links | Links in copyright bar may be indistinguishable from surrounding text. |

### 2.4 Screen Reader Verified Violations

| # | Criterion | Description | Evidence |
|---|-----------|-------------|----------|
| 16 | 2.4.1 Bypass Blocks | **No skip navigation link.** First Tab stop goes to carousel links ("MarsMobile app"), not a skip-to-content link. Users must tab through 60+ carousel links before reaching navigation. | Transcript index [3]: first tab lands on "MarsMobile app link" |
| 17 | 2.4.3 Focus Order | **Tab order is illogical.** Positive `tabindex` values cause Tab to start in the middle of the page (carousel area), then jump to the form, then wrap to the browser chrome, then finally reach the header navigation. Expected: header → nav → content → form → footer. | Tab 1-17: carousel links → Tab 18-24: form fields → Tab 25-26: browser chrome → Tab 27+: back to header nav |
| 18 | 1.3.1 Info and Relationships | **H2 used for a paragraph.** The subtitle "A trip to Mars starts in your imagination..." is a full paragraph marked as `<h2>`. This is a structural misuse — screen reader users navigating by headings will hear the entire paragraph as a heading. | A11y tree: `heading "A trip to Mars starts in your imagination..." [level=2]` |
| 19 | 1.1.1 Non-text Content | **Carousel images use filename as alt text.** Image links announced as "icecream.jpg" and "mars2 Unlabeled image" — these are not meaningful descriptions. | Transcript indices [20]-[40]: repeated "mars2 Unlabeled image", "icecream.jpg image link" |
| 20 | 4.1.2 Name, Role, Value | **Button with only "..." as name.** Calendar trigger button announced as "... button" — not meaningful. | A11y tree: `button "..." [ref=e202]` |
| 21 | 2.4.4 Link Purpose | **Empty link in main navigation.** One of the 5 main nav links has no text — announced as "blank link" by Orca. | Transcript [235]: "blank link. blank link." / A11y tree: `link [ref=e21]` |
| 22 | 2.4.4 Link Purpose | **Links with non-descriptive image text.** Several links use image filenames as their accessible names: "icecream.jpg", "mars2", "Kids in space suits", "Wookie". | Transcript [9]: "icecream.jpg link" |

---

## 3. Screen Reader Verification

### 3.1 Document Structure

**Page Title:** "Mars Commuter: Travel to Mars for Work or Pleasure!" — Descriptive and present. (Pass for 2.4.2)

**Heading Hierarchy** (from a11y tree):
```
H1: Destination Mars
H2: A trip to Mars starts in your imagination... (entire paragraph — structural misuse)
  H3: Be Bold...
  H3: Countdown...
  H3: Blast Off!
  H3: 10% off Crater Adventure (×3 carousel repeats)
  H3: Free Astronaut Ice Cream (×3)
  H3: Lowest Price Guarantee (×3)
  H3: Send Your Kids to Mars! (×3)
  H3: Fly with a Wookie (×3)
  H3: Get Radio on Uranus (×3)
  H3: Free Year on Mars (×3)
  H3: Let the Adventure Begin!
  H3: Book your Trip
  H3: Who Is Traveling?
  H3: Life was possible on Mars
    H4: Book Your Trip
    H4: Mars Shuttles
    H4: Mars Tourist Passes
    H4: Mars Adventures
    H4: FAQs
    H4: Connect With Us
```
**Issues:** H2 misused for paragraph text. Carousel headings repeat 3× each. No H2 between H1 and H3 sections (skipped level).

**Landmarks** (from a11y tree):
- Multiple `navigation` regions present (unlabeled — cannot be distinguished)
- No `main` landmark
- No `banner` landmark
- No `contentinfo` landmark
- 42 elements outside any landmark region

**Images Checked:**
- Multiple "mars2 Unlabeled image" instances — missing alt text
- "icecream.jpg" — filename used as alt, not descriptive
- "Mars Lander", "Kids in space suits", "Wookie", "Martian sunrise.", "Beautiful baboon, blowing bubbles, biking backward" — alt text present but some are non-descriptive
- "thumbnail-image" — YouTube thumbnail button has non-descriptive name

### 3.2 Keyboard Navigation

**Tab Order (observed):**
1. Tabs 1-17: Carousel promotion links (MarsMobile app → Fly with a Wookie!) — due to positive `tabindex`
2. Tabs 18-24: Form fields (From → To → Departure Date → time combo → another From/To/Date cycle → combo → gap)
3. Tab 25-26: Escapes to browser chrome (address bar)
4. Tabs 27-28: "Add a trip" / "Find a pass" header links
5. Tabs 29+: Back into form fields again, then header navigation (Login, Sign In, MarsCommuter, Travel Agents...)
6. Eventually reaches main nav (Send me to Mars, Hotels, Things to Do, Mars Map)
7. Then cycles through carousel again, form again, video controls, social embeds, footer links

**Critical Issues:**
- Tab order does not follow visual layout (carousel first, not header)
- Form fields appear in the tab sequence multiple times (duplicate tab stops)
- User escapes to browser chrome mid-page, then returns to different content
- No skip navigation mechanism

**No keyboard traps detected** — user can always Tab away from every element (Pass for 2.1.2).

### 3.3 Forms

**Labeled fields:**
- "From:" textbox — labeled (Pass)
- "To:" textbox — labeled (Pass)
- "Departure Date" textbox — labeled (Pass)
- Search textbox — labeled "search" (Pass)

**Unlabeled fields:**
- Time `<select>` — announced as "combo box 12 pm" with no field label (Fail)
- Traveler type `<select>` — announced as "combo box Adult (26+)" with no field label (Fail)

**Buttons:**
- "Submit" (search) — labeled (Pass)
- "Search" (trip form) — labeled (Pass)
- "..." (calendar trigger) — non-descriptive name (Fail)
- Unnamed button `[ref=e203]` — no name at all (Fail)

**Radio buttons:**
- "Find Fares & Schedules", "MarsCommuter Passes", etc. — labeled (Pass)
- "One-Way", "Round-Trip", "Multi-Planet" — labeled (Pass)
- "Yes"/"No" — labeled but missing context (what is the question?) (Needs review)

### 3.4 Interactive Components

**Carousel/Slider:**
- Contains 3 sets of 7 promotional items, appearing to be an auto-rotating carousel
- Navigation dots (links `[ref=e31-e33]`) have no accessible names
- No pause/stop mechanism identified
- Items announced redundantly 3 times

**YouTube Video Embed:**
- Iframe titled "NASA: Life on Mars Was a Possibility" (Pass)
- Video controls (Play, Hide controls, Share) are labeled (Pass)
- "thumbnail-image" button name is non-descriptive (Fail)

**Facebook Like Box:**
- Iframe has no `title` attribute (Fail)

**Twitter Follow Button:**
- Iframe titled "Twitter Follow Button" (Pass)

**Language Dropdown:**
- "Your language" link reveals English/Martian/Klingon options
- Implemented as links within a list item, not as a proper menu widget

---

## 4. Passes

| Criterion | Evidence |
|-----------|----------|
| 2.4.2 Page Titled | Title "Mars Commuter: Travel to Mars for Work or Pleasure!" is descriptive |
| 2.1.2 No Keyboard Trap | Full Tab traversal completed without traps |
| 2.4.4 Link Purpose (most links) | Navigation links (Hotels, Mars Map, Travel Agents, etc.) have clear purpose |
| 3.2.1 On Focus | No unexpected context changes observed when tabbing through elements |
| 1.3.1 Form Labels (partial) | From, To, Departure Date, Search textboxes properly labeled |
| 2.4.5 Multiple Ways | Site Map link present in footer; navigation provides alternative paths |

---

## 5. Confidence Levels

### High Confidence
- **html-has-lang** — axe confirmed, trivially verifiable
- **image-alt** (4 images) — axe confirmed + screen reader announced "Unlabeled image"
- **link-name** (8 links) — axe confirmed + screen reader announced "blank link"
- **button-name** — axe confirmed + screen reader announced "button" with no name
- **select-name** (2 selects) — axe confirmed + screen reader announced "combo box" with no label
- **frame-title** (Facebook iframe) — axe confirmed
- **No skip navigation** — confirmed by Tab traversal; first Tab lands on carousel
- **Tab order disrupted** — confirmed by positive `tabindex` + observed Tab sequence

### Medium Confidence
- **color-contrast** — axe identified 6 failures, but 87 elements were "incomplete" due to background gradients/images
- **H2 misuse** — heading contains a full paragraph; clearly structural misuse but intent is ambiguous
- **link-in-text-block** — axe flagged 1 confirmed + 3 incomplete; visual verification limited
- **Carousel auto-rotation** — structure suggests it rotates but could not confirm timing/pause behavior without longer observation
- **Focus indicators** — Orca reported focus items correctly, but screenshots from headless environment cannot reliably verify visible focus ring contrast

### Low Confidence
- **aria-prohibited-attr** — axe flagged on YouTube embed; this may be YouTube's own markup and may behave differently across versions
- **duplicate-id-aria** — axe marked incomplete; could not verify the exact ARIA referencing behavior
- **Reflow at 320px** — `agent-browser execute` command was unavailable; could not test viewport resize
- **Text spacing (1.4.12)** — could not inject CSS overrides; untested

---

## 6. Human Review Required

### Could Not Test
- **1.4.10 Reflow (320px):** The `agent-browser execute` command was not available in this environment. Viewport resize testing could not be performed. Human should test at 320px CSS width.
- **1.4.12 Text Spacing:** Could not inject WCAG text spacing overrides. Human should test with line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em, paragraph spacing 2em.
- **1.4.13 Content on Hover/Focus:** Could not hover elements in headless environment. Human should check any tooltips, popovers, or hover-triggered content for dismissibility and persistence.
- **1.4.11 Non-text Contrast:** Cannot reliably measure contrast ratios from headless screenshots. Human should verify form field borders, icon contrast, and focus indicators meet 3:1 ratio.
- **2.4.7 Focus Visible / 2.4.11 Focus Appearance:** Orca reported focused items but headless Chromium screenshots cannot reliably show CSS focus indicators. Human should visually verify focus rings on all interactive elements.
- **3.3.1 Error Identification / 3.3.3 Error Suggestion:** Could not trigger form validation errors (submitting the form would navigate away). Human should submit the form with empty/invalid data and verify error messages are announced and associated with fields.
- **2.4.11 Focus Not Obscured:** Cannot verify in headless environment whether sticky headers or other elements obscure focused items.
- **Carousel auto-play (2.2.2 Pause, Stop, Hide):** Carousel appears to have rotating content but auto-play timing could not be confirmed. If it auto-rotates, a pause mechanism is required.

### Tested But Uncertain
- **Color contrast (1.4.3):** 87 elements flagged as "incomplete" by axe — backgrounds contain gradients or images that prevent automated contrast calculation. Human should spot-check text over the Mars background image.
- **link-in-text-block (1.4.1):** 3 footer links marked incomplete — human should verify they are visually distinguishable from surrounding text (underline or 3:1 contrast difference).
- **Radio button context:** "Yes"/"No" radio buttons lack visible context — human should verify what question they answer and whether a `<fieldset>`/`<legend>` is needed.
- **Reading order (1.3.2):** Reading order follows DOM order and is roughly logical, but carousel repetition (same 7 items 3 times) may confuse screen reader users. Intent is unclear.

### Out of Scope
- **WCAG 2.2 criteria requiring full application context:** 3.2.6 Consistent Help, 3.3.7 Redundant Entry
- **Authentication criteria:** 3.3.8 Accessible Authentication — not a login flow
- **Mobile/touch testing:** 2.5.1 Pointer Gestures, 2.5.7 Dragging Movements
- **Multi-page consistency:** 3.2.3 Consistent Navigation, 3.2.4 Consistent Identification (single-page audit)
- **Cross-AT verification:** Tested only with Orca + Chromium on Linux. Results may differ with NVDA, JAWS, or VoiceOver on macOS.

---

## 7. Limitations

1. **Single AT/browser combination.** This audit used Orca (Linux screen reader) + Chromium for Testing. Results may differ with NVDA, JAWS, VoiceOver, or other browser combinations. A conformance claim requires testing with multiple AT/browser pairs.

2. **Automated checks are not comprehensive.** axe-core catches ~30-40% of WCAG issues. The remaining issues require human judgment.

3. **Point-in-time snapshot.** Dynamic content (carousel rotation, embedded social widgets) may produce different results at different times.

4. **Headless environment limitations.** Screenshots were captured in a headless Linux environment. Visual characteristics like focus indicators, hover states, and color contrast may not render identically to a user's desktop browser.
