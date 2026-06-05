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

    function addIndicator(el: Element, name: string, detectedBy: string): boolean {
      if (seenElements.has(el)) return false;
      seenElements.add(el);
      if (loadingIndicators.length >= MAX_PER_ARRAY) return true; // stop scanning
      loadingIndicators.push({
        selector: selectorFor(el),
        tagName: el.tagName.toLowerCase(),
        hasAccessibleName: name.length > 0,
        accessibleName: name,
        detectedBy,
      });
      return false;
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

    // The `*` walk is the most expensive scan in this function. Cap the
    // total elements visited so a million-node DOM doesn't pin the page.
    const MAX_VISITED = 50_000;
    let visited = 0;
    for (const el of document.querySelectorAll("*")) {
      if (++visited > MAX_VISITED) break;
      const cls = el.className && typeof el.className === "string" ? el.className : "";
      if (loadingPatterns.test(cls)) {
        const stop = addIndicator(
          el,
          resolveAccessibleName(el),
          `class="${
            cls
              .trim()
              .split(/\s+/)
              .find((c) => loadingPatterns.test(c)) || ""
          }"`,
        );
        if (stop) break; // indicator cap hit — no point walking further
      }
    }

    const issues: string[] = [];
    if (busyEls.length > 0) {
      issues.push(`${busyEls.length} element(s) with aria-busy="true"`);
    }
    if (loadingIndicators.length > 0) {
      const unlabeled = loadingIndicators.filter((li) => !li.hasAccessibleName);
      if (unlabeled.length > 0) {
        issues.push(`${unlabeled.length} loading indicator(s) WITHOUT accessible names`);
      }
      const labeled = loadingIndicators.filter((li) => li.hasAccessibleName);
      if (labeled.length > 0) {
        issues.push(`${labeled.length} loading indicator(s) with accessible names`);
      }
    }
    if (liveEls.length > 0) {
      issues.push(`${liveEls.length} live region(s) found`);
    } else if (busyEls.length > 0 || loadingIndicators.length > 0) {
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
