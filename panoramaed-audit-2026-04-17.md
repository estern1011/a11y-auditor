# Panorama Education — WCAG 2.2 AA Audit

**Audit date:** 2026-04-17
**Auditor:** Claude Code (auditor skill) on Linux/Orca via sprite env-1
**AT/browser:** Orca (Linux) + Chromium 147 (Playwright)
**Tools used:** `collect.ts`, `audit.ts` (axe-core), `agent-browser`, `drivers/orca/driver.ts`

## 1. Summary

Pages audited:

| URL | Title | Role |
| --- | --- | --- |
| https://www.panoramaed.com/ | Panorama Education \| Top Educational Software for Schools | Marketing home (primary) |
| https://www.panoramaed.com/request-demo | Get a Demo \| Panorama Education | Lead form |
| https://www.panoramaed.com/about | Panorama Education (about) | Content page (accordion) |
| https://secure.panoramaed.com/login | Panorama Education | Auth entry point |

Overall posture: **Does not conform** to WCAG 2.2 AA. There are several site-wide chrome failures (main nav, footer nav, logo link, footer landmarks) that propagate to every page of the marketing domain, plus page-specific failures on the login screen (no `<main>`, placeholder-only labels, disabled pinch-zoom) and the About page (malformed `tablist`/`tab` accordion).

## 2. Violations

### 2.1 Site-wide (marketing domain, every marketing page)

| # | WCAG | axe rule | Impact | Evidence |
| --- | --- | --- | --- | --- |
| V-1 | **1.3.1 Info & Relationships**, **4.1.2 Name, Role, Value** | `aria-prohibited-attr` | serious | Top-level nav items are `<span id="mm-dt-1" …>` and `<div class="main--link … products" aria-label="Products" aria-haspopup="true" aria-expanded="false">`. A `<span>`/`<div>` with no role cannot carry `aria-label` or `aria-expanded`. Orca announces them only as "Expand the Products dropdown, section" — no button role, no real menu semantics. (14 nodes in axe: 5 divs + 5 spans in header, 4 in footer wrapper.) |
| V-2 | **4.1.2 Name, Role, Value**, **1.3.1** | `aria-allowed-attr` | critical | Same nav items: 14 nodes carry `aria-expanded` on elements whose computed role doesn't support it. Even after clicking `#mm-dt-1` and the menu visually opening, `aria-expanded` stays `"false"` — **expanded state is never communicated to AT**. Verified via `getAttribute("aria-expanded")` after the submenu was rendered. |
| V-3 | **4.1.2** | `aria-valid-attr-value` / broken `aria-controls` | serious (axe reports "incomplete"; promoted after manual check) | Each `#mm-dt-N` span has `aria-controls="mm--N"` but no element with id `mm--N` exists in the DOM. Confirmed `document.querySelector("#mm--1")` returns `null`. |
| V-4 | **2.4.4 Link Purpose (In Context)**, **1.1.1 Non-text Content** | `link-name` | serious | Header logo `<a class="no-stroke no-fill" href="https://www.panoramaed.com/">` and footer logo link have no accessible text — SVG inside has no `<title>` and no `aria-label`. Orca announces them as just "link" (index 3, 15, and 65 of the tab walk). |
| V-5 | **2.4.1 Bypass Blocks** | n/a (manual) | moderate | No skip-to-content link. The only `a[href^="#"]` on the homepage is a newsletter-modal opener. `<main>` exists on the marketing pages so strict 2.4.1 can still pass via the landmark test, but keyboard users must tab through 3–17+ chrome stops (depending on page) before reaching content. |
| V-6 | **1.3.1**, **1.3.6** | `landmark-unique` | moderate | Five `<nav aria-label="Navigation Menu">` landmarks on every page (header mega-menu rendered as 5 nav wrappers). A screen reader's landmark navigation reads "Navigation Menu, navigation" five times in a row — user can't distinguish header nav from footer nav. |
| V-7 | **4.1.2**, **2.4.7** | `aria-hidden-focus` | serious | `.slick-logo-holder` carousel slides have `aria-hidden="true"` *and* `tabindex="0"`. Hidden-from-AT element is still in the tab order — focus lands on something invisible to screen readers. Occurred at tab stops 15–17 of the walk, which Orca announced only as "link" (no name). |
| V-8 | **1.4.1 Use of Color** (marginal), **1.3.1** | n/a | moderate | Nav items use `aria-haspopup="true"` to indicate submenu, but the visual down-arrow SVG inside `#mm-dt-N` has no accessible name. Works only because a sighted user sees the chevron. |
| V-9 | **2.5.3 Label in Name** (borderline) | n/a | low | Dropdown toggle visible label = "Products", accessible name = "Expand the Products dropdown". Not strictly a failure (visible text is a substring only in a different sense), but it's a 2.5.3 concern worth the designer's eye. |

### 2.2 Homepage (`/`) specific

| # | WCAG | axe rule | Impact | Evidence |
| --- | --- | --- | --- | --- |
| V-10 | **1.3.1**, **2.4.6 Headings and Labels** | `empty-heading` | minor | 4× `<h6 class="my-0 u-color--green/teal-secondary">` inside a "Tab expander" accordion (product tabs) are empty in the DOM; text is rendered only via image/sibling content. Orca announces "blank heading 6" four times at stops 34–37 of the heading navigation. |
| V-11 | **1.3.1** | `heading-order` | moderate | Heading sequence on the homepage: h1 → h4 ("Built for educators…") → h4 ("Proven impact…") → h2 → h6 (empty) ×4 → h2 → h2 → h4 → h2 → h3. Multiple level skips (h1→h4, h2→h6, h6→h2). |
| V-12 | **1.1.1** | (not flagged by axe — manual) | moderate | Filename-style alt text on district logos: `alt="Hueneme_Elementary_Schoool_District_Logo"` (note the misspelling), `"Durham_Public_School_official_logo"`, `"BPS_Logo_Rectangle_Navy"`, `"ESSA_Level_II_IV_Badges_1x2_Transparent_v1"`. axe's `image-alt` only requires *some* alt, not *meaningful* alt — human review caught these. |
| V-13 | **1.3.1**, **4.1.2** | (not flagged — manual) | moderate | The "Tab expander" product carousel uses `role="tabpanel"` on elements like `e51 … e53` and `role="tab"` on `"1 of 3"` through `"7 of 3"` — tab labels literally say "4 of 3", "5 of 3" … up to "7 of 3". Labels are mathematically impossible and useless to AT users. |
| V-14 | **1.4.10 Reflow** | (not flagged — manual) | moderate | At 320×800 viewport, `document.documentElement.scrollWidth` is 329px (9px horizontal overflow); multiple `.section` and `.container--fluid` elements have `scrollWidth = 329`. Minor but violates 1.4.10. |
| V-15 | **1.4.13 Content on Hover or Focus** / **4.1.2** | (not flagged — manual) | moderate | The Qualified "Nora" chat widget at the bottom-right occupies ~50% of the 320px-wide viewport, cannot be dismissed from the keyboard alone (Escape closes menus but does not dismiss the iframe widget), and covers the article CTA buttons on mobile. Also generated `nested-interactive` (serious) on nested `<div role="button">` inside a clickable message card. |
| V-16 | **3.3.2 Labels or Instructions** | (not flagged — manual) | moderate | Footer newsletter form: `<input name="term" type="text" placeholder="Search">` has no `<label>`, no `aria-label`, only a placeholder. Orca announces "Search, entry" (attribute fallback), but without the placeholder this would be invisible. |

### 2.3 Login page (`https://secure.panoramaed.com/login`)

| # | WCAG | axe rule | Impact | Evidence |
| --- | --- | --- | --- | --- |
| V-17 | **1.1.1** | `image-alt` | critical | `<img class="logo" src="…vertical-full-color-logo…">` has no `alt`. |
| V-18 | **1.3.1**, **2.4.1** | `landmark-one-main`, `region` | moderate | No `<main>` landmark. 6 content blocks (the student-art overlay, logo, heading, email field, password field, Google sign-in) are outside any landmark. |
| V-19 | **2.4.6**, **1.3.1** | `page-has-heading-one` | moderate | Page has an `<h3>` "Welcome to Panorama" but no `<h1>`. |
| V-20 | **1.4.4 Resize Text** (and **1.4.10**) | `meta-viewport` | moderate | `<meta name="viewport" content="width=device-width, maximum-scale=1, initial-scale=1, user-scalable=0">` — disables pinch-zoom and caps zoom at 100%. Users with low vision cannot scale text. |
| V-21 | **1.3.1**, **3.3.2** | (not flagged by axe's `label` rule because of placeholder; manual) | serious | Email input and password input rely on `placeholder="Email"` / `placeholder="Password"` as the sole label. No `<label for=…>` and no `aria-label`. Placeholder disappears on typing → user loses context. |
| V-22 | **1.3.5 Identify Input Purpose**, **3.3.8 Accessible Authentication (Min.)** (context-dependent) | (not flagged) | moderate | `<input id="user_password" autocomplete="off">` — discouraging password managers on a login form. Removes the primary 3.3.8 accommodation. |

### 2.4 Request-a-Demo (`/request-demo`)

Inherits all site-wide issues (V-1 … V-9). Additional:

| # | WCAG | axe rule | Impact | Evidence |
| --- | --- | --- | --- | --- |
| V-23 | **3.3.1 Error Identification**, **3.3.3 Error Suggestion** | (not flagged by axe) | serious (potential) | The HubSpot progressive form advances on Next click without any client-side validation announcement, even with empty/invalid email. No `aria-invalid` toggled, no `role="alert"` fired, no live region found (`{invalid: [], errors: []}` after empty submit). A real submission was not attempted (would generate a lead). **Human review required** to confirm server-side error handling is AT-accessible. |

### 2.5 About (`/about`)

Inherits site-wide issues. Additional:

| # | WCAG | axe rule | Impact | Evidence |
| --- | --- | --- | --- | --- |
| V-24 | **1.3.1**, **4.1.2** | `aria-allowed-role`, `aria-required-children`, `aria-required-parent` | critical | `<section class="accordion" role="tablist" aria-live="polite">` with `<article>` children that each contain `<span role="tab">`. `tablist` requires `tab` children directly, not through `article`. The same element is also misusing `role="tablist"` for what is actually an accordion pattern (should be disclosure / `button` + `aria-expanded`). |
| V-25 | **4.1.1 Parsing** (2.1 legacy; 2.2 removed but still best-practice) | duplicate-id (not in axe output here but visible in markup) | moderate | Every accordion trigger has `id="tab1"` and `aria-controls="panel1"` — all 10 triggers share the same ID. Confirmed in the `aria-required-parent` node list. |

## 3. Screen Reader Verification

Walked 71+ tab stops with Orca on Chromium. Highlights:

- **Tab stops 3, 15, 16, 17, 65**: focus lands but Orca announces only "link" (no name). These are the header logo, carousel slides, and footer logo — confirms V-4 and V-7 from the a11y-tree evidence.
- **Tab stops 4–8 ("Expand the Products dropdown, section", "…Solutions…", etc.)**: Orca announces role "section" with `has-popup`, never "button". Pressing Enter/Return opens the visual menu but the `aria-expanded` stays `"false"` and Orca announces nothing new — user has no audio confirmation the menu opened. Confirms V-1 / V-2.
- **Heading navigation (FIND_NEXT_HEADING)**: at positions 5–8 of the heading list Orca says "blank heading 6" four times in a row. Confirms V-10.
- **Landmark navigation (FIND_NEXT_LANDMARK)**: `leaving main content. leaving main content. Navigation Menu navigation Navigation Menu navigation …` — five consecutive "Navigation Menu navigation" announcements confirm V-6.
- **Cookie modal**: Opening moves focus to the Close button (good). Escape closes (good). But `document.body.inert === false` and there is no `role="dialog"` / `aria-modal="true"` on the container — AT users can still tab into background page content while the modal is up. Switches are exposed correctly (`[checked=true, disabled]` for Essential; others toggleable). Axe finds no violations in the modal itself. **Overall: partial pass.**
- **Qualified "Nora" chat iframe**: exposed with `title="Qualified Messenger"` (pass). However, inside the iframe the consent line `"This chat may be recorded as per our Privacy Policy"` has `aria-live="polite"` — fine — but the link color fails contrast (axe `color-contrast` serious), and a message card uses nested interactive controls (`<div role="button">` containing another clickable).

## 4. Passes (verified)

| Criterion | Evidence |
| --- | --- |
| 3.1.1 Language of Page | `<html lang="en">` on every page audited. |
| 2.4.2 Page Titled | All four pages have unique, descriptive titles. |
| 2.4.5 Multiple Ways | Marketing pages offer top nav, footer nav, and blog/resources search. |
| 2.4.7 Focus Visible (partial) | Dropdown toggle `#mm-dt-1` gets a 3px `rgb(0,109,176)` outline, login submit gets a 5px `rgb(16,16,16)` outline — focus indicators are present on the interactive elements that *matter most*, though 130 interactive elements have `outline-style:none` computed and would need per-element verification (`:focus-visible` may restore them — automated check cannot tell). |
| 2.1.1 Keyboard (partial) | Every tab stop I walked could be reached and Escape closed modals/menus. No keyboard traps observed. |
| 2.4.4 Link Purpose (mostly) | Most link texts are descriptive; exceptions tracked in V-4 and social-share "empty" links. |
| 1.2.x Media | No `<video>` or `<audio>` elements on the four pages audited. |
| Demo form labelling | `/request-demo` HubSpot form has proper `<label>` associations, `aria-required`, `aria-invalid` defaults, and `aria-labelledby` — labels-and-instructions pass on the form fields. |

## 5. Confidence Levels

- **High** — V-1, V-2, V-4, V-6, V-7, V-10, V-11, V-17, V-18, V-19, V-20, V-24, V-25 (axe-confirmed + SR/DOM verified).
- **High** — V-3 (DOM check directly confirmed `#mm--1` doesn't exist; axe reported as "incomplete" but evidence is definitive).
- **High** — V-21 (DOM check confirmed `hasLabel: false, ariaLabel: null`).
- **Medium** — V-5, V-8, V-12, V-13, V-14, V-15, V-16, V-22 (manual observations; interpretation room exists).
- **Medium** — V-9 (label-in-name borderline).
- **Low** — V-23 (couldn't complete an end-to-end form submission without generating real lead).

## 6. Human Review Required

**Could not test:**
- Form error messaging (V-23): real submission needed; check whether error `role="alert"` or live regions are inserted.
- Authenticated app behind `secure.panoramaed.com/login` — auditing stopped at the login screen.
- Caption/audio-description quality: no media on the four sampled pages; the rest of the marketing site has "Webinars" and "Product Tours" sections that were not visited.
- NVDA/JAWS + Chrome/Edge/Firefox combinations — this audit used Orca only.
- Magnification and high-contrast / Windows Contrast Mode interactions on the disabled-zoom login page (V-20).

**Tested but uncertain:**
- V-8, V-9, V-16 wording is subjective.
- 130 elements with `outline-style:none` — human should confirm that `:focus-visible` rules supply a visible indicator elsewhere (my eval only checked static computed style).
- V-14: 9px overflow at 320px may be cookie-icon / chat widget overlay, not real layout break — verify with the widgets hidden.
- Cookie-modal dialog semantics (no `role=dialog`, no `aria-modal`) — does NVDA/JAWS still announce it usefully? Subjective.
- V-15: "Nora" chat dismissibility — I did not find a keyboard-reachable close control but the iframe is third-party; confirm with vendor.

**Out of scope:**
- 3.2.6 Consistent Help (requires whole-site crawl).
- 3.3.7 Redundant Entry (multi-step flow).
- 3.3.8 Accessible Authentication cognitive-test criteria (beyond the `autocomplete="off"` observation).
- 2.5.x Pointer / gesture criteria (mobile-touch, not tested).

## 7. Limitations / Disclaimers

1. **Single AT/browser combination.** Orca on Linux + Chromium 147. NVDA / JAWS / VoiceOver iOS / TalkBack results will differ.
2. **Automated checks are not comprehensive.** axe-core catches ~30–40% of WCAG issues; of the 25 violations listed, 13 were found only by manual/SR inspection or by cross-checking axe "incomplete" items.
3. **Point-in-time snapshot.** Marketing pages pull in HubSpot, Qualified, and Osano third-party scripts whose DOM can change under us.
4. **Media not played.** No media was encountered on the four audited pages; remaining marketing media requires human review.
5. **Behind-auth product not audited.** Only the public marketing surface + the sign-in entry was inspected.
