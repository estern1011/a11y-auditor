/**
 * Page readiness detection for SPAs and async-loaded content.
 *
 * Design:
 * - MutationObserver is the primary signal — watches DOM, reports when
 *   mutations settle (no changes for `settleMs`).
 * - Periodic check-ins as a fallback — if the observer doesn't settle
 *   (e.g. animations, canvas, iframes), the agent gets nudged to look.
 * - Targeted loading-state check — audits 4.1.3-related patterns only
 *   (aria-busy, aria-live, role=status, spinner labels), not a full axe run.
 *   This avoids noise from legitimately-incomplete content.
 *
 * No networkidle — React Query, SWR, Apollo do background refetching so
 * the network never truly goes idle.
 *
 * No LCP — stops reporting on user interaction, only tracks one element,
 * skeleton screens fool it, no SPA route awareness.
 */

import type { Page } from "playwright";

// ---------------------------------------------------------------------------
// Loading state check — targeted 4.1.3 patterns
// ---------------------------------------------------------------------------

export interface LoadingStateResult {
  /** Is any element currently aria-busy="true"? */
  hasAriaBusy: boolean;
  /** Elements with aria-busy="true" and their selectors */
  ariaBusyElements: { selector: string; tagName: string; role: string | null }[];
  /** Are there any aria-live regions? */
  hasLiveRegions: boolean;
  /** Live regions found */
  liveRegions: {
    selector: string;
    tagName: string;
    ariaLive: string;
    role: string | null;
    textContent: string;
  }[];
  /** Elements with role=status, role=alert, role=progressbar, role=log */
  statusRoles: {
    selector: string;
    tagName: string;
    role: string;
    textContent: string;
    hasAccessibleName: boolean;
  }[];
  /** Loading indicators (spinners etc.) — heuristic detection */
  loadingIndicators: {
    selector: string;
    tagName: string;
    hasAccessibleName: boolean;
    accessibleName: string;
    /** How we detected it (aria-label, class name, role, etc.) */
    detectedBy: string;
  }[];
  /** Summary for the agent */
  summary: string;
}

export async function checkLoadingState(page: Page): Promise<LoadingStateResult> {
  return page.evaluate(() => {
    function selectorFor(el: Element): string {
      if (el.id) return `#${el.id}`;
      const tag = el.tagName.toLowerCase();
      const cls = el.className && typeof el.className === "string"
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
        : "";
      return `${tag}${cls}`;
    }

    function resolveAccessibleName(el: Element): string {
      const label = el.getAttribute("aria-label");
      if (label) return label;
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const resolved = labelledBy.split(/\s+/)
          .map(id => document.getElementById(id)?.textContent?.trim() || "")
          .filter(Boolean)
          .join(" ");
        if (resolved) return resolved;
      }
      return el.getAttribute("title") || "";
    }

    function truncate(s: string, max = 80): string {
      const t = s.trim().replace(/\s+/g, " ");
      return t.length > max ? t.slice(0, max) + "…" : t;
    }

    // aria-busy="true" elements
    const busyEls = Array.from(document.querySelectorAll('[aria-busy="true"]'));
    const ariaBusyElements = busyEls.map(el => ({
      selector: selectorFor(el),
      tagName: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
    }));

    // aria-live regions (exclude aria-live="off" and non-announcing roles
    // like marquee/timer that don't communicate loading state)
    const liveEls = Array.from(document.querySelectorAll(
      '[aria-live], [role="status"], [role="alert"], [role="log"]'
    )).filter(el => {
      const live = el.getAttribute("aria-live");
      return live !== "off";
    });
    const liveRegions = liveEls.map(el => ({
      selector: selectorFor(el),
      tagName: el.tagName.toLowerCase(),
      ariaLive: el.getAttribute("aria-live") || (
        el.getAttribute("role") === "alert" ? "assertive" : "polite"
      ),
      role: el.getAttribute("role"),
      textContent: truncate(el.textContent || ""),
    }));

    // Status/progress roles
    const statusEls = Array.from(document.querySelectorAll(
      '[role="status"], [role="alert"], [role="progressbar"], [role="log"]'
    ));
    const statusRoles = statusEls.map(el => {
      const name = resolveAccessibleName(el);
      return {
        selector: selectorFor(el),
        tagName: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || "",
        textContent: truncate(el.textContent || ""),
        hasAccessibleName: name.length > 0 || (el.textContent || "").trim().length > 0,
      };
    });

    // Loading indicators — heuristic detection
    const loadingIndicators: LoadingStateResult["loadingIndicators"] = [];
    const seenElements = new Set<Element>();
    const loadingPatterns = /loading|spinner|skeleton|progress|fetching|waiting/i;

    function addIndicator(el: Element, name: string, detectedBy: string) {
      if (seenElements.has(el)) return;
      seenElements.add(el);
      loadingIndicators.push({
        selector: selectorFor(el),
        tagName: el.tagName.toLowerCase(),
        hasAccessibleName: name.length > 0,
        accessibleName: name,
        detectedBy,
      });
    }

    // Check by aria-label
    document.querySelectorAll("[aria-label]").forEach(el => {
      const label = el.getAttribute("aria-label") || "";
      if (loadingPatterns.test(label)) {
        addIndicator(el, label, "aria-label");
      }
    });

    // Check by role=progressbar
    document.querySelectorAll('[role="progressbar"]').forEach(el => {
      addIndicator(el, resolveAccessibleName(el), "role=progressbar");
    });

    // Check by class names
    document.querySelectorAll("*").forEach(el => {
      const cls = el.className && typeof el.className === "string" ? el.className : "";
      if (loadingPatterns.test(cls)) {
        addIndicator(el, resolveAccessibleName(el), `class="${cls.trim().split(/\s+/).find(c => loadingPatterns.test(c)) || ""}"`);
      }
    });

    // Build summary
    const issues: string[] = [];
    if (busyEls.length > 0) {
      issues.push(`${busyEls.length} element(s) with aria-busy="true"`);
    }
    if (loadingIndicators.length > 0) {
      const unlabeled = loadingIndicators.filter(li => !li.hasAccessibleName);
      if (unlabeled.length > 0) {
        issues.push(`${unlabeled.length} loading indicator(s) WITHOUT accessible names`);
      }
      const labeled = loadingIndicators.filter(li => li.hasAccessibleName);
      if (labeled.length > 0) {
        issues.push(`${labeled.length} loading indicator(s) with accessible names`);
      }
    }
    if (liveEls.length > 0) {
      issues.push(`${liveEls.length} live region(s) found`);
    } else if (busyEls.length > 0 || loadingIndicators.length > 0) {
      issues.push("No aria-live regions to announce loading state to screen readers");
    }

    const summary = issues.length > 0
      ? `Loading state detected: ${issues.join("; ")}`
      : "No loading indicators detected — page may be fully loaded or missing loading a11y";

    return {
      hasAriaBusy: busyEls.length > 0,
      ariaBusyElements,
      hasLiveRegions: liveEls.length > 0,
      liveRegions,
      statusRoles,
      loadingIndicators,
      summary,
    } satisfies LoadingStateResult;
  });
}

// ---------------------------------------------------------------------------
// DOM observer — MutationObserver with periodic check-in fallback
//
// Starts observing, reports status on demand. The agent polls /observe-status
// to check if the DOM has settled or is still mutating.
// ---------------------------------------------------------------------------

export interface ObserverState {
  /** Is the observer currently running? */
  active: boolean;
  /** Has the DOM settled (no mutations for settleMs)? */
  settled: boolean;
  /** Total mutations observed since start */
  mutationCount: number;
  /** ms since last mutation (0 if never mutated) */
  msSinceLastMutation: number;
  /** ms since observation started */
  elapsed: number;
  /** Settle threshold being used */
  settleMs: number;
}

export interface ObserverHandle {
  /** Get current state without stopping */
  status(): Promise<ObserverState>;
  /** Stop observing and clean up */
  stop(): Promise<ObserverState>;
}

export interface StartObserverOptions {
  /** DOM quiet period before declaring settled (default 2000ms) */
  settleMs?: number;
}

// The observer injection script — stored as a string so it can be
// re-injected after every navigation (page.goto loads a new document,
// wiping all injected JS).
const OBSERVER_INJECT = `(function(settleMs) {
  if (window.__a11yObserver) return;

  var state = {
    active: true,
    settled: false,
    mutationCount: 0,
    lastMutationTime: 0,
    startTime: Date.now(),
    settleMs: settleMs,
  };

  var timer = null;
  var observer = new MutationObserver(function(mutations) {
    if (!state.active) return;
    state.mutationCount += mutations.length;
    state.lastMutationTime = Date.now();
    state.settled = false;

    if (timer) clearTimeout(timer);
    timer = setTimeout(function() {
      state.settled = true;
    }, settleMs);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  timer = setTimeout(function() {
    state.settled = true;
  }, settleMs);

  window.__a11yObserver = {
    state: state,
    observer: observer,
    stop: function() {
      state.active = false;
      observer.disconnect();
      if (timer) clearTimeout(timer);
    },
  };
})`;

export async function startObserver(
  page: Page,
  options: StartObserverOptions = {},
): Promise<ObserverHandle> {
  const settleMs = options.settleMs ?? 2000;

  // Inject into the current page
  async function inject() {
    await page.evaluate(`${OBSERVER_INJECT}(${settleMs})`);
  }

  // Re-inject after every navigation
  const onLoad = async () => {
    try { await inject(); } catch { /* page may be closing */ }
  };
  page.on("load", onLoad);

  // Inject now
  await inject();

  const getStatus = async (): Promise<ObserverState> => {
    return page.evaluate((settleMs) => {
      const obs = (window as any).__a11yObserver;
      if (!obs) {
        return {
          active: false,
          settled: false,
          mutationCount: 0,
          msSinceLastMutation: 0,
          elapsed: 0,
          settleMs,
        };
      }
      const { state } = obs;
      const now = Date.now();
      return {
        active: state.active,
        settled: state.settled,
        mutationCount: state.mutationCount,
        msSinceLastMutation: state.lastMutationTime > 0
          ? now - state.lastMutationTime
          : 0,
        elapsed: now - state.startTime,
        settleMs: state.settleMs,
      };
    }, settleMs);
  };

  const stop = async (): Promise<ObserverState> => {
    page.removeListener("load", onLoad);
    const status = await getStatus();
    await page.evaluate(() => {
      const obs = (window as any).__a11yObserver;
      if (obs) {
        obs.stop();
        delete (window as any).__a11yObserver;
      }
    });
    return { ...status, active: false };
  };

  return { status: getStatus, stop };
}

// ---------------------------------------------------------------------------
// waitForSelector — simple Playwright wrapper exposed via HTTP
// ---------------------------------------------------------------------------

export interface WaitForSelectorOptions {
  selector: string;
  state?: "visible" | "attached" | "detached" | "hidden";
  timeout?: number;
}

export interface WaitResult {
  success: boolean;
  elapsed: number;
  detail: string;
}

export async function waitForSelector(
  page: Page,
  options: WaitForSelectorOptions,
): Promise<WaitResult> {
  const { selector, state = "visible", timeout = 30_000 } = options;
  const start = Date.now();
  try {
    await page.locator(selector).waitFor({ state, timeout });
    return {
      success: true,
      elapsed: Date.now() - start,
      detail: `${selector} reached state "${state}"`,
    };
  } catch (e) {
    // Only treat Playwright timeout errors as expected timeouts.
    // Other errors (malformed selector, closed page, invalid state) should propagate.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Timeout") || msg.includes("exceeded")) {
      return {
        success: false,
        elapsed: Date.now() - start,
        detail: `Timeout: ${selector} did not reach "${state}" within ${timeout}ms`,
      };
    }
    throw e;
  }
}
