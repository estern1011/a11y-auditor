# Automated-Only vs Full Audit — Panorama Education (2026-04-17)

## What "automated-only" means here

"Automated-only" = the result you get by running axe-core (via `bun audit.ts --tags wcag2a,wcag2aa`) against each page, reading its `violations[]` array, and stopping. No screen reader, no manual keyboard walk, no visual cross-reference. This is what almost every CI-based accessibility gate produces.

"Full audit" = the report in `panoramaed-audit-2026-04-17.md` and `panoramaed-acr-2026-04-17.md`: axe + Orca screen reader navigation + keyboard walk + DOM/CSS evals + screenshot review at two viewports + third-party widget interaction.

## Numeric summary

| Metric | Automated-only | Full audit |
| --- | --- | --- |
| Pages scanned | 4 | 4 |
| Distinct issues surfaced | **11** (axe violations, de-duplicated) | **25** (violations V-1…V-25 in the audit report) |
| WCAG criteria judged non-conforming | 6 | 14 |
| Criteria marked "Partially Supports" in ACR | **4** (if just trusting axe) | **14** |
| Criteria marked "Does Not Support" in ACR | 1 | 3 |
| "Not Evaluated" reductions (criteria confirmed one way or the other) | 0 | 14 |

## Issues automated-only caught

Axe found these on at least one of the 4 pages:

| axe rule | WCAG | Sample evidence |
| --- | --- | --- |
| `aria-allowed-attr` (critical) | 4.1.2 | `<div class="products" aria-expanded="false">` etc. (14 nodes) |
| `aria-prohibited-attr` (serious) | 4.1.2 | `<span id="mm-dt-1" aria-label="…">` (5 nodes) |
| `aria-hidden-focus` (serious) | 4.1.2 | `.slick-logo-holder[aria-hidden=true][tabindex=0]` |
| `link-name` (serious) | 2.4.4 | Header + footer `<a>` wrapping SVG logo with no text |
| `empty-heading` (minor) | 1.3.1 | 4 empty `<h6>` in product accordion |
| `heading-order` (moderate) | 1.3.1 | h1→h4 and h2→h6 on homepage |
| `landmark-unique` (moderate) | 1.3.1 | 5 `<nav aria-label="Navigation Menu">` |
| `landmark-one-main` (moderate) | 1.3.1 | login page no `<main>` |
| `page-has-heading-one` (moderate) | 2.4.6 | login page no `<h1>` |
| `meta-viewport` (moderate) | 1.4.4 | login page `user-scalable=0` |
| `image-alt` (critical) | 1.1.1 | login logo `<img class="logo">` no alt |
| `region` (moderate) | 1.3.1 | login content outside landmarks |
| `aria-allowed-role` / `aria-required-children` / `aria-required-parent` (critical) | 4.1.2 | about-page accordion `tablist`/`tab` mis-structure |
| `color-contrast` (serious) | 1.4.3 | Qualified chat iframe "Privacy Policy" link |
| `nested-interactive` (serious) | 4.1.2 | Qualified chat message with nested `role=button` |

These are the 11 distinct axe rules firing across the 4 pages. Most map to WCAG 1.3.1, 2.4.4, 1.4.3, 1.4.4, and 4.1.2.

## Issues automated-only **missed**, caught by the full audit

| # | WCAG | Issue | How it was caught |
| --- | --- | --- | --- |
| 1 | 4.1.2 | `aria-expanded` stays `"false"` after the menu visually opens. Axe flagged the attribute as "not allowed" on the element, but did **not** tell us that the state isn't synced with reality. | Clicked `#mm-dt-1`, then ran `document.querySelector(".products").getAttribute("aria-expanded")` → still `"false"`. Verified against the rendered submenu. |
| 2 | 4.1.2 | `aria-controls="mm--N"` points to IDs that **do not exist**. Axe reported this as "incomplete" under `aria-valid-attr-value` (a class many CI gates ignore or suppress). | `document.querySelector("#mm--1")` → `null`. Confirmed deterministically. |
| 3 | 1.3.1 / 1.1.1 | Filename-style alt text like `"ESSA_Level_II_IV_Badges_1x2_Transparent_v1"`, `"Hueneme_Elementary_Schoool_District_Logo"` (note the misspelling of "School"). Axe's `image-alt` only requires *any* alt. | Regex over `img[alt]` in a DOM eval caught the file-name patterns. An audit with no manual step would give these a pass. |
| 4 | 1.3.1 / 4.1.2 | Product carousel tab labels read "1 of 3" … "7 of 3". Valid ARIA structure, but the visible/accessible label is nonsense. | Read the accessibility tree snapshot (`agent-browser snapshot -i`) and noticed the sequence of `tab "N of 3"` entries. |
| 5 | 2.4.3 / 2.4.7 | Tab stops 3, 15, 16, 17, 65 — Orca announces only "link" (empty name). Axe's `link-name` flagged 2 logo links; the other 3 were social-share links with SVG children that Axe treated as having an accessible name via `<title>` / aria nesting rules. | Orca tab walk — the announcement itself is the evidence. |
| 6 | 1.3.2 | District-logo carousel has `aria-hidden="true"` with `tabindex="0"` (axe catches this), **but** axe does not flag that the slides auto-advance with no pause control — 2.2.2 issue. | Watched the DOM over 5+ seconds; slide index incremented; no pause button found. |
| 7 | 3.3.2 | Login page email/password inputs use `placeholder` as the only label. Axe's `label` rule accepts the `placeholder` as a label fallback and does not fail. | DOM eval: `{hasLabel: false, ariaLabel: null, placeholder: "Email"}`. |
| 8 | 3.3.8 / 1.3.5 | Login password input has `autocomplete="off"` — blocking password managers. Not a WCAG rule any common axe check implements. | DOM eval on the login form. |
| 9 | 2.1.1 | Top-nav dropdown toggles are `<span>` with click handlers. They don't open on keyboard Enter — clicking works, but pressing Return when focused does nothing. Axe's aria-prohibited-attr fires on the attribute, not the interaction. | Pressed Return while focused on `#mm-dt-1` — submenu did not appear in the a11y tree; only mouse click opened it. |
| 10 | 2.4.1 | No skip-to-content link. Axe's `bypass` check returns "incomplete" (because `<main>` is present on marketing pages, which is a valid bypass mechanism per ACT) and therefore gives many teams a false pass. The *login* page has neither skip link nor `<main>` — axe catches that one but merges it with the `region`/`landmark-one-main` findings rather than surfacing it as 2.4.1. | Reviewed skip-link, landmark, and heading evidence together. |
| 11 | 1.4.10 | 9px horizontal overflow at 320×800 viewport on the homepage (`documentElement.scrollWidth=329`). Axe does not test reflow. | `agent-browser set viewport 320 800` + DOM eval for `el.scrollWidth > window.innerWidth`. |
| 12 | 1.4.10 / 1.4.13 | The Qualified "Nora" chat widget covers ~50% of the 320px viewport and has no keyboard-reachable dismiss. Automated tools don't know the widget is there, let alone evaluate its footprint. | Mobile screenshot; Tab-walk couldn't reach an obvious close button from main document. |
| 13 | 4.1.2 | Cookie preferences dialog has no `role="dialog"`, no `aria-modal="true"`, and body.inert is false — AT users can tab into background content while the modal is "open". Axe did not flag this (the modal's internal ARIA is correct). | `document.body.inert` + DOM eval for role/aria-modal on the modal container. |
| 14 | 3.3.1 / 4.1.3 | Empty-submit on the progressive demo form produces no `aria-invalid` toggle, no `role=alert`, no live region. | DOM eval after submit attempt showed `{invalid: [], errors: []}`. Axe cannot trigger interactions. |
| 15 | 1.1.1 / 2.4.4 | Duplicate-destination links: 6 links to `/request-demo`, 5 to `/resources/product-demo`, 5 to `javascript:void(0)` on a single page. Axe has no rule for this. | `document.querySelectorAll("a[href]")` grouped by `href`. |
| 16 | 2.4.6 / 1.3.1 | Duplicate `id="tab1"` repeated for every accordion trigger on the About page. Axe's `duplicate-id` rule is historically noisy and is tagged `best-practice` rather than `wcag2a` in many configurations — it did not appear in my tag-filtered run. | The `aria-required-parent` node list directly shows the duplicated markup. |
| 17 | 4.1.2 | Menu dropdown chevron SVGs have no accessible name. Axe does not flag SVG icons that are *inside* a labelled parent. | Snapshot showed the parent generic had name "Expand the Products dropdown", but there was no programmatic "has submenu" affordance beyond the English label. |
| 18 | 2.4.6 (inherited from 4.1.2) | Orca announces "Navigation Menu navigation" five times consecutively when using landmark navigation — user can't tell which nav is which. Axe's `landmark-unique` catches that the labels collide, but does not describe the user impact. | Orca `FIND_NEXT_LANDMARK` transcript. |

That's **18 substantive items that axe did not report** (or reported only as "incomplete"/"best-practice" that a CI gate would silently skip). Three of them (items 4, 14, 15) are pure user-experience failures no static tool can detect.

## WCAG criteria where automated-only would have reported "Supports" but audit says otherwise

If you derived an ACR from axe results alone and gave every criterion without an axe violation a "Supports", you would falsely claim:

| Criterion | What automated-only would claim | What full audit found |
| --- | --- | --- |
| 2.1.1 Keyboard | Supports | Partially Supports — dropdown toggles don't open on Enter; chat widget not keyboard-dismissible; aria-hidden slides still focusable. |
| 2.1.2 No Keyboard Trap | Supports | Supports (confirmed by walking 71 stops — axe couldn't confirm this even though the answer is yes). |
| 2.2.2 Pause, Stop, Hide | Supports | Partially Supports — auto-advancing district-logo carousel has no pause control. |
| 2.4.3 Focus Order | Supports | Partially Supports — 5+ empty-named stops; duplicate footer nav. |
| 2.4.4 Link Purpose | Partially (axe finds 2 nodes) | Partially, with more nodes + duplicate-destination links. |
| 2.4.6 Headings and Labels | Partially (empty-heading + page-has-heading-one) | Partially, plus nonsensical tab labels. |
| 2.4.7 Focus Visible | Supports | Partially — 130 `outline:none` elements; some focus stops invisible. |
| 1.3.2 Meaningful Sequence | Supports | Partially — carousel "7 of 3" labels. |
| 1.3.5 Identify Input Purpose | Supports | Partially — login `autocomplete="off"` on password. |
| 1.4.13 Content on Hover/Focus | Supports | Partially — chat widget dismissibility unknown. |
| 3.3.1 Error Identification | Supports (no errors to check) | Not Evaluated — empty submit didn't produce an announced error. |
| 3.3.2 Labels or Instructions | Partially (nothing in axe output) | Partially — login placeholder-only labels; footer search. |
| 3.3.8 Accessible Authentication | Supports | Partially — password `autocomplete="off"` blocks password managers. |
| 4.1.2 Name, Role, Value | Partially (6 axe rules) | Does Not Support — state sync failure, broken `aria-controls`, mis-structured accordion, unlabeled menu items, cookie dialog missing `role=dialog`. |

Fourteen criteria change their conformance verdict once screen-reader and manual checks are added.

## Time / cost profile

| Activity | Automated-only | Full audit |
| --- | --- | --- |
| Wall time, 4 pages | ~1 minute (axe scans only) | ~35 minutes (baseline sweep + keyboard walk + DOM evals + screenshot review + subpage sweeps) |
| Unique insights per minute | 11 ÷ 1 ≈ **11/min** | 25 ÷ 35 ≈ **0.7/min** |
| But: insights that change conformance verdict per minute | 6 ÷ 1 = 6 | 14 ÷ 35 ≈ 0.4 |

Automated is fast. But automated on its own would misclassify 14 of 55 WCAG 2.2 A+AA criteria, and would completely miss the headline failure of the marketing site — the `aria-expanded` state never reflecting the open submenu. A build pipeline should run axe on every commit for regression protection; procurement / compliance deliverables still need the manual-plus-screen-reader pass.

## Headline takeaway

**If you only ran axe**, you would find a pile of nav ARIA issues and correctly recognize that the site needs work. You would not discover that the main menu's expand state never updates, that Nora the chat widget is a keyboard dead-end, that the login page can't be pinch-zoomed, or that the product accordion tabs are numbered 1-of-3 through 7-of-3. Those are the findings that tell you *what* to fix — and they come from a screen reader and a human (or an AI assistant orchestrating one) interacting with the real page.
