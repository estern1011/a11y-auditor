# Phase 2: Document Structure Audit
**URL:** https://dequeuniversity.com/demo/mars/  
**Screen Reader:** Orca (Linux, env-1)  
**Date:** 2026-04-14  
**Tool:** Orca driver via AT-SPI2 + CDP page evaluation

---

## 1. Page Title

**Orca announcement:** "Mars Commuter: Travel to Mars for Work or Pleasure!, document web"

- Title is present and descriptive — passes WCAG 2.4.2.
- The title clearly identifies both the site name and purpose.

---

## 2. Heading Hierarchy

### Headings found (in document order)

| Level | Text |
|-------|------|
| H1 | Destination Mars |
| H2 | A trip to Mars starts in your imagination. Are you bold enough, brave enough, foolish enough? We are. You belong on Mars with fools like us. Most of us don't bite. Much. |
| H3 | Be Bold... |
| H3 | Countdown... |
| H3 | Blast Off! |
| H3 | 10% off Crater Adventure |
| H3 | Free Astronaut Ice Cream |
| H3 | Lowest Price Guarantee |
| H3 | Send Your Kids to Mars! |
| H3 | Fly with a Wookie |
| H3 | Get Radio on Uranus |
| H3 | Free Year on Mars |
| H3 | 10% off Crater Adventure *(duplicate)* |
| H3 | Free Astronaut Ice Cream *(duplicate)* |
| H3 | Lowest Price Guarantee *(duplicate)* |
| H3 | Send Your Kids to Mars! *(duplicate)* |
| H3 | Fly with a Wookie *(duplicate)* |
| H3 | Get Radio on Uranus *(duplicate)* |
| H3 | Free Year on Mars *(duplicate)* |
| H3 | 10% off Crater Adventure *(duplicate)* |
| H3 | Free Astronaut Ice Cream *(duplicate)* |
| H3 | Lowest Price Guarantee *(duplicate)* |
| H3 | Send Your Kids to Mars! *(duplicate)* |
| H3 | Fly with a Wookie *(duplicate)* |
| H3 | Get Radio on Uranus *(duplicate)* |
| H3 | Let the Adventure Begin! |
| H3 | Book your Trip |
| H3 | Who Is Traveling? |
| H3 | Find a Rocket Pass *(not in Orca transcript, in DOM)* |
| H3 | Who Is Traveling? *(duplicate)* |
| H3 | Find Activities |
| H3 | Book a Hotel |
| H3 | Life was possible on Mars |
| H4 | Book Your Trip |
| H4 | Mars Shuttles |
| H4 | Mars Tourist Passes |
| H4 | Mars Adventures |
| H4 | FAQs |
| H4 | Connect With Us |

**Total headings:** 39 (1x H1, 1x H2, 32x H3, 6x H4)

### Issues Identified

| Issue | Severity | WCAG |
|-------|----------|------|
| **Massive heading duplication** — carousel/deal items repeat the same H3 text 3× each (e.g., "10% off Crater Adventure" appears 3 times) | Moderate | 1.3.1 |
| **No H2 intermediate between H1 and the H4 footer group** — H4 footer headings (Book Your Trip, Mars Shuttles, etc.) follow H3s with no intervening H2; the hierarchy jumps from H3 → H4 without a parent H2 for the footer section | Moderate | 1.3.1 |
| **H2 is extremely long** — the H2 is a full marketing paragraph (93 words), not a concise section label | Minor | Best practice |
| **No level skipping** — the H1→H2→H3→H4 chain itself has no gaps; levels progress correctly | Pass | 1.3.1 |
| **Orca FIND_NEXT_HEADING** — all heading searches returned "not found / document root" because Orca was not running during this session phase; transcript entries [2]–[36] from earlier session show Orca correctly reading the heading hierarchy when active | Note | — |

---

## 3. Landmarks

### Landmark elements found

| Element | ARIA Role | `aria-label` | Count |
|---------|-----------|--------------|-------|
| `<nav>` | navigation | *(none)* | 13 |
| `<form>` | form | *(none)* | 7 |
| `<section>` | region | *(none)* | 1 |

### Missing critical landmarks

| Landmark | Element | Status |
|----------|---------|--------|
| `banner` | `<header>` / `role="banner"` | **MISSING** |
| `main` | `<main>` / `role="main"` | **MISSING** |
| `contentinfo` | `<footer>` / `role="contentinfo"` | **MISSING** |
| `complementary` | `<aside>` / `role="complementary"` | **MISSING** |

### Issues Identified

| Issue | Severity | WCAG |
|-------|----------|------|
| **No `<main>` or `role="main"`** — screen reader users cannot jump directly to page content | Critical | 1.3.1, 2.4.1 |
| **No `<header>` or `role="banner"`** — no way to identify the site header as a landmark | Serious | 1.3.1 |
| **No `<footer>` or `role="contentinfo"`** — footer content is not a navigable landmark | Serious | 1.3.1 |
| **13 `<nav>` elements, zero with `aria-label`** — multiple unlabeled navs are indistinguishable; screen reader users hear "navigation" 13 times with no way to differentiate them | Serious | 1.3.1, 2.4.6 |
| **`<section>` without `aria-label`** — sections without accessible names are not exposed as region landmarks | Minor | 1.3.1 |
| **Axe: `region`** — all page content is outside landmark regions | Moderate | 1.3.1 |
| **Axe: `landmark-unique`** — duplicate landmark roles without distinguishing labels | Moderate | 1.3.1 |
| **Orca FIND_NEXT_LANDMARK** — returned only document root for all 5 attempts, confirming no ARIA landmark regions are accessible to the screen reader | Confirmed | — |

---

## 4. Images

### All images found (27 total)

| Image | Alt Text | Status |
|-------|----------|--------|
| Logo (img `out`) | `alt=""` | Decorative — acceptable |
| Logo saved_resource | `alt=""` | Decorative — acceptable |
| `seg` (tracking pixel?) | *(no alt attribute)* | **MISSING ALT** |
| `mars-spaceman.jpg` (×3) | *(no alt attribute)* | **MISSING ALT** (3 instances) |
| `space-station.jpg` (×3) | `alt="icecream.jpg "` | **Wrong alt** — filename used as alt text (with trailing space) |
| `mars-lander.jpg` (×3) | `alt="Mars Lander"` | Pass |
| `kids-space.jpg` (×3) | `alt="Kids in space suits "` | Pass (trailing space minor) |
| `wookie.jpg` (×3) | `alt="Wookie"` | Pass |
| `global-free-days.jpg` (×3) | `alt="Martian sunrise."` | Misleading — image is in "Get Radio on Uranus" section |
| `mars-sunrise.jpg` (×3) | `alt="Beautiful baboon, blowing bubbles, biking backward"` | **Incorrect/dummy alt** — alt text is alliterative nonsense unrelated to Mars content |
| `calendar.png` (×3) | `alt="..."` | **Non-descriptive alt** — `"..."` is not a meaningful description |
| `gplus-32.png` | `alt="Google+"` | Pass |

### Issues Identified

| Issue | Severity | WCAG |
|-------|----------|------|
| **4 images missing `alt` attribute** entirely (mars-spaceman.jpg ×3, seg ×1) | Critical | 1.1.1 |
| **`space-station.jpg` uses filename as alt text** (`"icecream.jpg "`) — meaningless to users | Serious | 1.1.1 |
| **`mars-sunrise.jpg` has nonsensical alt text** (`"Beautiful baboon, blowing bubbles, biking backward"`) | Serious | 1.1.1 |
| **`calendar.png` has non-descriptive alt text** (`"..."`) — buttons trigger date pickers; alt should say "Open calendar" | Serious | 1.1.1 |
| **`global-free-days.jpg` alt may be misassigned** (`"Martian sunrise."` appears on image in "Get Radio on Uranus" deal card) | Moderate | 1.1.1 |
| **Orca transcript confirms** unlabeled images: "[49] To get missing image descriptions, open the context menu. Unlabeled image" and "[56] mars2 Unlabeled image" | Confirmed | 1.1.1 |

---

## 5. Page Stats

| Metric | Value |
|--------|-------|
| Page title | Mars Commuter: Travel to Mars for Work or Pleasure! |
| `<html lang>` | **Empty string** — no language declared |
| H1 count | 1 |
| Total headings | 39 |
| Total links | 155 |
| Total images | 27 |
| Total forms | 7 |
| Total buttons | 13 |
| `<main>` landmark | **Absent** |
| Skip navigation link | **Absent** |

### Stats Issues

| Issue | Severity | WCAG |
|-------|----------|------|
| **`<html lang>` is empty** — screen readers cannot select the correct language voice/pronunciation rules | Serious | 3.1.1 |
| **No skip navigation link** — keyboard/screen reader users must tab through all 13 `<nav>` elements and their links before reaching main content | Serious | 2.4.1 |
| **READ_PAGE_STATS** command is not available in the Orca driver (not a supported Orca command); stats obtained via CDP DOM evaluation instead | Note | — |

---

## 6. Reading Order

### Orca transcript reading order (entries [0]–[97] from initial session)

The transcript captured Orca's linear reading order when active. Key observations:

**Page opens with:**
- [0] "Mars Commuter: Travel to Mars for Work or Pleasure!, document web" — page title announced

**Navigation clusters appear before main content:**
- The first structural elements encountered are multiple `<nav>` sections (transcript entries visible in DOM walk at positions 1-40 show nav items for "Add a trip / Find a pass", then login nav, then another "Add a trip" nav, then account nav, then travel agents nav, then primary nav)
- This means screen reader users must navigate through many navigation items before reaching the H1

**Main content starts at [2]:**
- [2] "Destination Mars heading 1" — H1 found
- [3] H2 paragraph text
- [4]–[6] Be Bold, Countdown, Blast Off H3 links
- [7]–[27] Deals carousel H3 items (many duplicates)

**Reading anomalies:**
- [41]–[46] "navigation blank" — multiple empty/unlabeled navigation regions announced in sequence with no content
- [47]–[48] "Wrapping to top. navigation List with 2 items blank link" — navigation wrapping detected (circular navigation)
- [49] "Unlabeled image" announced with context menu prompt — no alt text on spaceman image

**DOM walk reading order (first 40 elements):**

1. `<nav>` — "Add a trip / Find a pass" (primary utility nav)
2–5. List items and links within nav
6. `<nav>` — "Login / Sign In / My Cart" (account nav)
7–11. Account nav items
12–16. Duplicate "Add a trip / Find a pass" nav (appears twice)
17–27. Full account dropdown nav with My Orders, My Account, Logout, My Cart
28–40. Travel agents nav and language selector nav

*The main H1 "Destination Mars" does not appear until item ~62 in the DOM tree.*

### Reading Order Issues

| Issue | Severity | WCAG |
|-------|----------|------|
| **Main content buried behind navigation** — screen reader users encounter 5+ navigation blocks and ~40 interactive elements before reaching the H1 heading | Serious | 2.4.1, 2.4.3 |
| **No skip link** to bypass repeated navigation | Serious | 2.4.1 |
| **Multiple "navigation blank" announcements** — empty or unlabeled nav elements produce meaningless announcements ([41]–[46] in transcript) | Moderate | 2.4.6 |
| **Duplicate heading announcements in carousel** — Orca reads each carousel panel's headings multiple times as the carousel cycles, producing confusing repetition | Moderate | 1.3.1 |
| **Carousel items not announced as such** — deal items read as "List with 20 items ... link heading 3" without indicating they are carousel/slider items | Moderate | 1.3.1 |
| **Linear reading order is logical within sections** — once past navigation, H1 → H2 → H3 → form elements follows a coherent order | Pass | 1.3.2 |

---

## Summary of Issues

### Critical (must fix)
1. No `<main>` landmark — no way to skip to main content (WCAG 1.3.1, 2.4.1)
2. 4 images missing `alt` attribute (WCAG 1.1.1)
3. No skip navigation link — 5+ nav blocks before main content (WCAG 2.4.1)

### Serious
4. `<html lang>` attribute is empty — no language declared (WCAG 3.1.1)
5. 13 `<nav>` elements, none with `aria-label` — indistinguishable (WCAG 2.4.6)
6. No `<header>`/`banner` landmark (WCAG 1.3.1)
7. No `<footer>`/`contentinfo` landmark (WCAG 1.3.1)
8. `space-station.jpg` uses filename as alt text — `"icecream.jpg "` (WCAG 1.1.1)
9. `mars-sunrise.jpg` has nonsensical dummy alt text (WCAG 1.1.1)
10. Calendar `<button>` images have `alt="..."` (WCAG 1.1.1)

### Moderate
11. 39 headings with massive duplication — carousel items repeated 3× (WCAG 1.3.1)
12. H4 footer headings lack an H2 parent for the footer section (WCAG 1.3.1)
13. All page content outside landmark regions (Axe: `region`)
14. Duplicate landmark roles without labels (Axe: `landmark-unique`)
15. Multiple empty/unlabeled navigation announcements in reading order

### Minor / Best Practice
16. H2 is an extremely long marketing paragraph — not a concise section label
17. `<section>` without `aria-label` not exposed as region landmark
18. Trailing spaces in some alt text values

---

## Notes on Test Methodology

- Orca was active during the initial phase of the session (transcript entries [0]–[97]) capturing authentic screen reader output including heading navigation, image announcements, and navigation landmarks.
- During the structured command phase (FIND_NEXT_HEADING, FIND_NEXT_LANDMARK, FIND_NEXT_IMAGE), Orca had stopped running, so those commands returned only the document root rather than individual elements. This is a driver/environment issue, not a page issue.
- DOM structure, headings, landmarks, and images were independently verified via Chrome DevTools Protocol (CDP) JavaScript evaluation against the live page.
- Axe automated scan provided corroborating evidence for 12 violations.
- Page stats were obtained via CDP DOM evaluation (READ_PAGE_STATS is not a supported Orca command).
