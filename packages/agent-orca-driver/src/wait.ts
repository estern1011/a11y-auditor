/**
 * Page readiness detection for SPAs and async-loaded content.
 *
 * Design:
 * - MutationObserver is the primary signal — watches DOM, reports when
 *   mutations settle (no changes for `settleMs`).
 * - Periodic check-ins as a fallback — if the observer doesn't settle
 *   (animations, canvas, iframes), the agent can poll status.
 * - Targeted loading-state check — audits 4.1.3-related patterns only
 *   (aria-busy, aria-live, role=status, spinner labels), not a full axe run.
 *
 * No networkidle — React Query / SWR / Apollo do background refetching so
 * the network never truly goes idle.
 */

import type { Page } from "playwright";

// ---------------------------------------------------------------------------
// Loading state check — targeted 4.1.3 patterns
// ---------------------------------------------------------------------------

export interface LoadingStateResult {
  hasAriaBusy: boolean;
  ariaBusyElements: { selector: string; tagName: string; role: string | null }[];
  hasLiveRegions: boolean;
  liveRegions: {
    selector: string;
    tagName: string;
    ariaLive: string;
    role: string | null;
    textContent: string;
  }[];
  statusRoles: {
    selector: string;
    tagName: string;
    role: string;
    textContent: string;
    hasAccessibleName: boolean;
  }[];
  loadingIndicators: {
    selector: string;
    tagName: string;
    hasAccessibleName: boolean;
    accessibleName: string;
    detectedBy: string;
  }[];
  /**
   * True total count of indicators found on the page — unbounded by the per-
   * array cap on `loadingIndicators`. When `loadingIndicators.length === 200`
   * (the cap) and this is larger, the detail array is a sample; `summary`
   * still reflects the true labeled/unlabeled split.
   */
  loadingIndicatorsTotal: number;
  summary: string;
}

export async function checkLoadingState(page: Page): Promise<LoadingStateResult> {
  return page.evaluate(() => {
    // Per-array caps so a page with thousands of status/loading elements can't
    // balloon the JSON response. The COUNTS we report (busyEls.length etc.)
    // still reflect the true total — only the per-element detail arrays are
    // capped. SECURITY.md "Trust boundary" calls this out.
    const MAX_PER_ARRAY = 200;
    function clip<T>(arr: T[]): T[] {
      return arr.length > MAX_PER_ARRAY ? arr.slice(0, MAX_PER_ARRAY) : arr;
    }

    function selectorFor(el: Element): string {
      if (el.id) return `#${el.id}`;
      const tag = el.tagName.toLowerCase();
      const cls =
        el.className && typeof el.className === "string"
          ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
          : "";
      return `${tag}${cls}`;
    }

    function resolveAccessibleName(el: Element): string {
      const label = el.getAttribute("aria-label");
      if (label) return label;
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const resolved = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() || "")
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

    const busyEls = Array.from(document.querySelectorAll('[aria-busy="true"]'));
    const ariaBusyElements = clip(busyEls).map((el) => ({
      selector: selectorFor(el),
      tagName: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
    }));

    const liveEls = Array.from(
      document.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"]'),
    ).filter((el) => el.getAttribute("aria-live") !== "off");
    const liveRegions = clip(liveEls).map((el) => ({
      selector: selectorFor(el),
      tagName: el.tagName.toLowerCase(),
      ariaLive:
        el.getAttribute("aria-live") ||
        (el.getAttribute("role") === "alert" ? "assertive" : "polite"),
      role: el.getAttribute("role"),
      textContent: truncate(el.textContent || ""),
    }));

    const statusEls = Array.from(
      document.querySelectorAll(
        '[role="status"], [role="alert"], [role="progressbar"], [role="log"]',
      ),
    );
    const statusRoles = clip(statusEls).map((el) => {
      const name = resolveAccessibleName(el);
      return {
        selector: selectorFor(el),
        tagName: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || "",
        textContent: truncate(el.textContent || ""),
        hasAccessibleName: name.length > 0 || (el.textContent || "").trim().length > 0,
      };
    });

    const loadingIndicators: LoadingStateResult["loadingIndicators"] = [];
    const seenElements = new Set<Element>();
    const loadingPatterns = /loading|spinner|skeleton|progress|fetching|waiting/i;
    // Counters are TOTALS — incremented every time we see a new indicator,
    // regardless of whether it lands in the detail array. The summary at the
    // end of this function reads from these counters, NOT from
    // loadingIndicators.length, so a page with 1000 indicators (where the
    // first 200 happen to be labeled) still reports the trailing 800
    // unlabeled in the summary. Only the per-element details get clipped.
    let totalIndicators = 0;
    let totalLabeled = 0;
    let totalUnlabeled = 0;

    function addIndicator(el: Element, name: string, detectedBy: string): void {
      if (seenElements.has(el)) return;
      seenElements.add(el);
      const hasName = name.length > 0;
      totalIndicators++;
      if (hasName) totalLabeled++;
      else totalUnlabeled++;
      if (loadingIndicators.length >= MAX_PER_ARRAY) return; // counted, but don't store detail
      loadingIndicators.push({
        selector: selectorFor(el),
        tagName: el.tagName.toLowerCase(),
        hasAccessibleName: hasName,
        accessibleName: name,
        detectedBy,
      });
    }

    document.querySelectorAll("[aria-label]").forEach((el) => {
      const label = el.getAttribute("aria-label") || "";
      if (loadingPatterns.test(label)) {
        addIndicator(el, label, "aria-label");
      }
    });

    document.querySelectorAll('[role="progressbar"]').forEach((el) => {
      addIndicator(el, resolveAccessibleName(el), "role=progressbar");
    });

    // Walk EVERY element looking for class-name matches. TreeWalker (not
    // querySelectorAll("*"), which materializes a NodeList for the whole DOM
    // up front and defeats the visit cap on a million-node page) lets us
    // stop incrementally at the budget. nextNode() starts AFTER the root,
    // so process the root explicitly first — `<body class="loading">` is a
    // common SPA pattern that the previous querySelectorAll-based walk
    // included.
    const MAX_VISITED = 50_000;
    function inspect(el: Element): void {
      const cls = el.className && typeof el.className === "string" ? el.className : "";
      if (loadingPatterns.test(cls)) {
        addIndicator(
          el,
          resolveAccessibleName(el),
          `class="${
            cls
              .trim()
              .split(/\s+/)
              .find((c) => loadingPatterns.test(c)) || ""
          }"`,
        );
      }
    }
    const root = document.body || document.documentElement;
    let visited = 0;
    if (root) {
      inspect(root);
      visited++;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (let el = walker.nextNode() as Element | null; el; el = walker.nextNode() as Element | null) {
        if (++visited > MAX_VISITED) break;
        inspect(el);
      }
    }

    const issues: string[] = [];
    if (busyEls.length > 0) {
      issues.push(`${busyEls.length} element(s) with aria-busy="true"`);
    }
    if (totalIndicators > 0) {
      if (totalUnlabeled > 0) {
        issues.push(`${totalUnlabeled} loading indicator(s) WITHOUT accessible names`);
      }
      if (totalLabeled > 0) {
        issues.push(`${totalLabeled} loading indicator(s) with accessible names`);
      }
    }
    if (liveEls.length > 0) {
      issues.push(`${liveEls.length} live region(s) found`);
    } else if (busyEls.length > 0 || totalIndicators > 0) {
      issues.push("No aria-live regions to announce loading state to screen readers");
    }

    const summary =
      issues.length > 0
        ? `Loading state detected: ${issues.join("; ")}`
        : "No loading indicators detected — page may be fully loaded or missing loading a11y";

    return {
      hasAriaBusy: busyEls.length > 0,
      ariaBusyElements,
      hasLiveRegions: liveEls.length > 0,
      liveRegions,
      statusRoles,
      loadingIndicators,
      loadingIndicatorsTotal: totalIndicators,
      summary,
    } satisfies LoadingStateResult;
  });
}

// ---------------------------------------------------------------------------
// DOM observer
// ---------------------------------------------------------------------------

export interface ObserverState {
  active: boolean;
  settled: boolean;
  mutationCount: number;
  msSinceLastMutation: number;
  elapsed: number;
  settleMs: number;
}

export interface ObserverHandle {
  status(): Promise<ObserverState>;
  stop(): Promise<ObserverState>;
}

export interface StartObserverOptions {
  settleMs?: number;
}

// settleMs is passed as a real arg rather than interpolated into the source
// string, so it stays safe against JS injection even if upstream validation
// regresses.
function observerInject(settleMs: number): void {
  if ((window as any).__a11yObserver) return;

  const state = {
    active: true,
    settled: false,
    mutationCount: 0,
    lastMutationTime: 0,
    startTime: Date.now(),
    settleMs: settleMs,
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver((mutations) => {
    if (!state.active) return;
    state.mutationCount += mutations.length;
    state.lastMutationTime = Date.now();
    state.settled = false;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      state.settled = true;
    }, settleMs);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  timer = setTimeout(() => {
    state.settled = true;
  }, settleMs);

  (window as any).__a11yObserver = {
    state,
    observer,
    stop: () => {
      state.active = false;
      observer.disconnect();
      if (timer) clearTimeout(timer);
    },
  };
}

export async function startObserver(
  page: Page,
  options: StartObserverOptions = {},
): Promise<ObserverHandle> {
  const settleMs = options.settleMs ?? 2000;

  async function inject() {
    await page.evaluate(observerInject, settleMs);
  }

  const onLoad = async () => {
    try {
      await inject();
    } catch {
      /* page may be closing */
    }
  };
  page.on("load", onLoad);

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
        msSinceLastMutation: state.lastMutationTime > 0 ? now - state.lastMutationTime : 0,
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
// waitForSelector — Playwright wrapper exposed via HTTP
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
