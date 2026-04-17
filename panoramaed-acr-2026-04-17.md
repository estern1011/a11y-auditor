# Panorama Education Accessibility Conformance Report

**VPAT Version:** 2.5 WCAG Edition
**Product Name:** Panorama Education public marketing site + sign-in entry
**Product Version:** panoramaed.com, secure.panoramaed.com/login (as served on 2026-04-17)
**Report Date:** April 2026
**Product Description:** K-12 education AI / MTSS / surveys SaaS marketing surface and login gateway.
**Contact Information:** accessibility@panoramaed.com (suggested; confirm with vendor)
**Notes:** Scope covers 4 representative pages — `/`, `/request-demo`, `/about`, and `secure.panoramaed.com/login`. The authenticated product application behind the login screen was **not** evaluated. Findings behind site-wide chrome (top nav, footer, logo link) apply to every marketing page.
**Evaluation Methods Used:** axe-core 4.x via `@axe-core/playwright`; Orca screen reader on Linux (Ubuntu 25.10) driving Chromium 147 via `drivers/orca/driver.ts`; agent-browser 0.25 for DOM queries, screenshots, keyboard interaction; manual keyboard walk; visual inspection of screenshots at 1280×800 and 320×800 viewports.

## Applicable Standards/Guidelines

| Standard/Guideline | Included in Report |
| ------------------ | ------------------ |
| WCAG 2.2 Level A   | Yes                |
| WCAG 2.2 Level AA  | Yes                |
| WCAG 2.2 Level AAA | No                 |

## Terms

| Term | Definition |
| --- | --- |
| Supports | The functionality of the product has at least one method that meets the criterion without known defects or meets with equivalent facilitation. |
| Partially Supports | Some functionality of the product does not meet the criterion. |
| Does Not Support | The majority of product functionality does not meet the criterion. |
| Not Applicable | The criterion is not relevant to the product. |
| Not Evaluated | The product has not been evaluated against the criterion. |

## WCAG 2.2 Report — Level A

### Table 1: Success Criteria, Level A

| Criterion | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| **1.1.1 Non-text Content** | Partially Supports | Most marketing-page images carry alt text (axe `image-alt` passes on `/`, `/request-demo`, `/about`). Defects: (a) login page logo `<img class="logo" …vertical-full-color-logo…>` has no `alt` (axe `image-alt` critical, 1 node); (b) header and footer logo links on marketing pages contain only inline SVG with no accessible name, rendering as "link" (axe `link-name` serious, 2 nodes); (c) district-partner logos use filename alt text, e.g. `alt="Hueneme_Elementary_Schoool_District_Logo"`, `alt="ESSA_Level_II_IV_Badges_1x2_Transparent_v1"` — technically alt-present but not meaningful. |
| **1.2.1 Audio-only and Video-only (Prerecorded)** | Not Applicable | No `<audio>` or `<video>` elements on the four audited pages. Webinars/Podcasts pages were not audited. |
| **1.2.2 Captions (Prerecorded)** | Not Evaluated | No prerecorded video on sampled pages. Human review required for Webinars, Product Tours, and embedded YouTube content elsewhere on the site. |
| **1.2.3 Audio Description or Media Alternative (Prerecorded)** | Not Evaluated | Same as 1.2.2 — media not present on sampled pages. |
| **1.3.1 Info and Relationships** | Does Not Support | Multiple serious structural failures affect every marketing page: (a) main nav uses `<div>`/`<span>` with `aria-label`, `aria-expanded`, `aria-haspopup` and no role — axe `aria-prohibited-attr` (5 nodes), `aria-allowed-attr` (14 nodes); (b) `aria-controls="mm--N"` points to IDs that do not exist; (c) 5 `<nav aria-label="Navigation Menu">` landmarks repeat the same label (axe `landmark-unique`); (d) empty `<h6>` inside "Tab expander" accordions (axe `empty-heading`, 4 nodes); (e) heading levels skip (h1→h4, h2→h6) — axe `heading-order`; (f) login page has no `<main>` landmark and the Welcome block is outside any landmark (axe `landmark-one-main`, `region`); (g) about-page accordion misuses `role="tablist"`/`role="tab"` with `<article>` wrappers and duplicate `id="tab1"` (axe `aria-allowed-role`, `aria-required-children`, `aria-required-parent`); (h) login email/password fields use `placeholder` as the only label (no `<label>`, no `aria-label`) — not automatable, confirmed via DOM eval. |
| **1.3.2 Meaningful Sequence** | Partially Supports | Visual reading order matched DOM tab order for the hero and body content of every sampled page. Defect: product-stat carousel labels "1 of 3", "2 of 3" … up through "7 of 3" — the numbers are mathematically nonsensical and convey no real sequence to AT users. |
| **1.3.3 Sensory Characteristics** | Supports | No instructions found that rely on shape, color, size, or position alone on the sampled pages. |
| **1.4.1 Use of Color** | Partially Supports | Required-field marker uses a red asterisk but the label text includes `"*"` as well, so meaning isn't color-only. However, the main-nav dropdown indicator is a visual chevron SVG with no accessible equivalent, so the submenu affordance is color/shape-only for AT users. |
| **1.4.2 Audio Control** | Not Applicable | No auto-playing audio detected on sampled pages. |
| **2.1.1 Keyboard** | Partially Supports | All tab stops I walked could be reached and Escape closed menus/modals. Defects: (a) `.slick-logo-holder` carousel slides have `aria-hidden="true"` but `tabindex="0"` — axe `aria-hidden-focus` serious; (b) the Qualified "Nora" chat iframe cannot be dismissed from the keyboard (no visible or focusable close control was reachable via Tab / Escape); (c) several top-nav dropdown toggles open on click but do not open on keyboard Return or Space because they are `<span>` with click handlers, not buttons — tested by focusing `#mm-dt-1` and pressing Return; no menu items appeared in the accessibility tree. |
| **2.1.2 No Keyboard Trap** | Supports | No trap observed in 71+ tab stops across four pages. Escape always closed opened menus/modals. |
| **2.1.4 Character Key Shortcuts** | Not Evaluated | No visible single-character shortcuts; deeper product behind login not tested. |
| **2.2.1 Timing Adjustable** | Supports | No session timers or auto-dismiss on sampled pages. District-logo carousel auto-advances but has no time-limited content; screenshots taken 5 s apart confirmed no required-action timers. |
| **2.2.2 Pause, Stop, Hide** | Partially Supports | District-logo carousel on the homepage auto-advances with no pause control. The `aria-hidden="true" tabindex="0"` slides (see 2.1.1) also mean AT users can land on a slide that's invisible to their SR and has no way to pause. |
| **2.3.1 Three Flashes or Below Threshold** | Supports | Observed content contains no flashing. |
| **2.4.1 Bypass Blocks** | Partially Supports | Marketing pages have a `<main>` landmark (satisfies ACT rule via landmark mechanism). No skip-link is provided. The login page has no `<main>` at all — fails for that page. |
| **2.4.2 Page Titled** | Supports | All four audited pages have unique descriptive titles ("Panorama Education \| Top Educational Software for Schools", "Get a Demo \| Panorama Education", "How AI Ready Is Your District? [Infographic]" observed after auto-redirect, "Panorama Education" on the login screen — last one is generic but identifies the product). |
| **2.4.3 Focus Order** | Partially Supports | Observed tab order is largely logical. Defects: empty-named focus stops (header logo, carousel slides, footer logo) break the "what am I on?" mental model for AT users; the footer exposes a full duplicate navigation with 34+ stops after the cookie button. |
| **2.4.4 Link Purpose (In Context)** | Partially Supports | Most link texts are meaningful. Defects: header and footer logo links have no accessible name (axe `link-name`, 2 nodes); multiple social-share links (Facebook/Twitter/LinkedIn wrapped around SVG icons) have no text; homepage has 8+ `href="javascript:void(0);"` and 6+ duplicate `href="/request-demo"` links that an AT user must tab through redundantly. |
| **2.5.1 Pointer Gestures** | Not Evaluated | Not tested — mobile gesture testing out of scope. |
| **2.5.2 Pointer Cancellation** | Not Evaluated | Not tested. |
| **2.5.3 Label in Name** | Partially Supports | Dropdown toggles have visible label "Products" but accessible name "Expand the Products dropdown" — visible text is contained but not at the start; likely passes ACT but the asymmetry is worth noting. Submit buttons on forms have matching visible + accessible text. |
| **2.5.4 Motion Actuation** | Not Applicable | No motion-activated controls detected. |
| **3.1.1 Language of Page** | Supports | `<html lang="en">` set correctly on all four pages; axe `html-has-lang` / `html-lang-valid` pass. |
| **3.2.1 On Focus** | Supports | Tabbing through 71 stops produced no unexpected context changes. |
| **3.2.2 On Input** | Supports | Toggling the cookie-modal switches and focusing form fields did not trigger navigation or unexpected state changes. |
| **3.2.6 Consistent Help (WCAG 2.2)** | Not Evaluated | Requires multi-page comparison across the full site; only four pages were audited. The Qualified "Nora" chat widget appeared on every audited page, which is positive. |
| **3.3.1 Error Identification** | Not Evaluated | Attempted to submit the `/request-demo` form with an empty email; the form advanced to the next step without surfacing `aria-invalid`, a live region, or a `role="alert"`. A real error state (server-side rejection, invalid data) was not triggered to avoid generating spurious leads. Human review required. |
| **3.3.2 Labels or Instructions** | Partially Supports | `/request-demo` HubSpot form has proper `<label>` associations, `aria-labelledby`, `aria-required`. Defects: login page's Email and Password inputs have no `<label>` and no `aria-label` — placeholder only; footer newsletter Search has only a placeholder. |
| **3.3.7 Redundant Entry (WCAG 2.2)** | Not Evaluated | Only multi-step flow touched was the progressive demo form; multi-page redundant-entry check requires completing an end-to-end flow. |
| **4.1.2 Name, Role, Value** | Does Not Support | Primary failure pattern of the marketing site. Top-level nav "items" are `<div>`/`<span>` with no role but full ARIA menu attributes; `aria-expanded` stays `"false"` after the menu visually opens (verified directly); `aria-controls` references invalid IDs. About-page accordion uses a malformed `tablist`/`tab` pattern. Carousel slides are `aria-hidden="true"` yet focusable. Multiple links lack accessible names. Together these are ~23 nodes across every marketing page plus the login-page logo image. |

## WCAG 2.2 Report — Level AA

### Table 2: Success Criteria, Level AA

| Criterion | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| **1.2.4 Captions (Live)** | Not Applicable | No live media. |
| **1.2.5 Audio Description (Prerecorded)** | Not Evaluated | No video on sampled pages; Webinars/Product-Tour pages not audited. |
| **1.3.4 Orientation** | Supports | No orientation lock detected; `<meta viewport>` on the login page disables zoom (see 1.4.4) but does not lock orientation. |
| **1.3.5 Identify Input Purpose** | Partially Supports | HubSpot demo form uses `name="0-1/email"`, `0-1/firstname`, etc., with `type="email"`, `type="tel"` — browsers can autofill. Defect: login form has `<input type="password" autocomplete="off">`, blocking password-manager autofill — violates the intent of this criterion. |
| **1.4.3 Contrast (Minimum)** | Partially Supports | axe reports 0 normal-text contrast violations on marketing pages (incomplete items only, caused by gradient backgrounds). Defect: inside the Qualified "Nora" iframe, the "This chat may be recorded as per our [Privacy Policy]" link fails contrast (`axe color-contrast` serious, 2 nodes) on every page where the chat loads. Human should verify `h1` "Smarter support and learning…" against the gradient hero — axe flagged incomplete. |
| **1.4.4 Resize Text** | Does Not Support | Login page `<meta name="viewport" content="width=device-width, maximum-scale=1, initial-scale=1, user-scalable=0">`. `user-scalable=0` and `maximum-scale=1` prevent pinch-zoom and cap zoom at 100% on mobile browsers. Low-vision users cannot enlarge text. |
| **1.4.5 Images of Text** | Supports | No images-of-text observed; district-partner logos are allowed (logos are exempt). |
| **1.4.10 Reflow** | Partially Supports | At 320×800 viewport the homepage has 9px horizontal overflow (`documentElement.scrollWidth = 329`); several `.section` / `.container--fluid` elements exceed viewport width. The Qualified "Nora" chat widget dominates the mobile viewport (covers ~50% of visible area), obscuring CTA buttons. Content is still readable by scrolling, but the chat widget effectively hides content in the default state. |
| **1.4.11 Non-text Contrast** | Not Evaluated | Requires per-element contrast measurement against backgrounds; axe does not cover non-text contrast. Focus indicator on `#mm-dt-1` is `rgb(0,109,176)` 3px — likely passes 3:1. 130 elements have `outline-style:none` in computed style — may be overridden by `:focus-visible` but not verified. |
| **1.4.12 Text Spacing** | Not Evaluated | Injected WCAG text-spacing overrides were not captured in screenshot form. Human should verify on a production-like environment. |
| **1.4.13 Content on Hover or Focus** | Partially Supports | Menu dropdowns dismiss on Escape (good). The "Nora" chat popover does not have a keyboard-reachable dismiss control I could find; popovers in the footer "See Panorama in action" bar appear on focus only via click, not hover — acceptable. |
| **2.4.5 Multiple Ways** | Supports | Top nav, footer nav with additional categories, and content-search via the blog index all present. |
| **2.4.6 Headings and Labels** | Partially Supports | Most headings are descriptive. Defects: login page has `<h3>Welcome to Panorama</h3>` but no `<h1>` (axe `page-has-heading-one`); homepage has 4 empty `<h6>` inside accordion triggers. |
| **2.4.7 Focus Visible** | Partially Supports | Focus is visible on critical controls verified (nav dropdown toggle `#mm-dt-1` — 3px blue outline; login submit — 5px outline). However, 130 interactive elements have `outline-style:none` in computed style and only some restore via `:focus-visible`; elements focused via tab walk (header logo, carousel slides, some "images"-grouping generics) showed no visible indicator in the screen-reader announcements ("link" with no name). |
| **2.4.11 Focus Not Obscured (Minimum) — WCAG 2.2** | Not Evaluated | Requires sticky-header / overlay interaction testing across pages; not systematically verified. On quick scroll-through, the sticky `fix-header` does not appear to obscure focused fields, but the "Nora" chat widget covers the bottom-right CTAs on narrow viewports. |
| **2.5.7 Dragging Movements (WCAG 2.2)** | Not Evaluated | No drag interactions observed; full testing requires pointer-event exercise. |
| **2.5.8 Target Size (Minimum) — WCAG 2.2** | Not Evaluated | Button/link hit-area measurements not captured. Main CTA buttons visually appear to meet 24×24 CSS px; the `#mm-dt-N` chevron toggles are smaller — human should measure. |
| **3.1.2 Language of Parts** | Supports | All content on sampled pages is English; no secondary languages detected. |
| **3.2.3 Consistent Navigation** | Supports | Top nav and footer nav have identical items and order on all four pages. |
| **3.2.4 Consistent Identification** | Supports | "Get a Live Demo" / "Request a Demo" CTAs are consistently labeled across pages. |
| **3.3.3 Error Suggestion** | Not Evaluated | See 3.3.1 — error states not triggered. |
| **3.3.4 Error Prevention (Legal, Financial, Data)** | Not Applicable | No legal, financial, or data-deletion transactions on audited pages. |
| **3.3.8 Accessible Authentication (Minimum) — WCAG 2.2** | Partially Supports | Login page offers Google SSO (alternative to password). However, `autocomplete="off"` on the password field discourages password-manager autofill, which is the primary cognitive-function accommodation this criterion protects. |
| **4.1.3 Status Messages** | Not Evaluated | No status messages exercised — form submit did not produce a visible or announced status on the sampled empty-submit attempt. Human should confirm success/error toasts use `aria-live` / `role=status` / `role=alert`. |

## Evidence Index

- Full audit write-up: `panoramaed-audit-2026-04-17.md`
- Baseline evidence (axe JSON + SR transcripts + screenshot): `/tmp/audit/collect-home.json`
- Screenshots: `/tmp/audit/home-top.png`, `home-mid.png`, `home-mid2.png`, `home-bot.png`, `home-mobile.png`, `demo-top.png`, `demo-errors.png`, `login.png`, `annot-home.png`
- Per-page axe JSON: `/tmp/demo-audit.json`, `/tmp/about-audit.json`, `/tmp/login-audit3.json`, `/tmp/cookie-axe.json` (on sprite env-1)

## Disclaimers

1. Single AT/browser combination (Orca + Chromium 147 on Linux). NVDA, JAWS, VoiceOver iOS, TalkBack results may differ.
2. Automated tools catch an estimated 30–40% of WCAG issues; ~13 of the 25 findings in the audit write-up were found only through manual or screen-reader investigation.
3. Point-in-time snapshot (2026-04-17). Marketing pages incorporate third-party scripts (HubSpot, Qualified chat, Osano cookie) whose markup can change.
4. Behind-auth product application not audited.
5. Media playback / caption accuracy / transcript presence require human review.
