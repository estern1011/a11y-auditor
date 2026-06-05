/**
 * Contract tests for /loading-state's volume-cap defenses.
 *
 * The trust-boundary docs (SECURITY.md) and the commit messages on the
 * volume-cap series make a few specific promises:
 *   - `<html class="...">` and `<body class="...">` are both inspected.
 *   - Deep descendants are inspected.
 *   - On a huge DOM, the walk stops at MAX_VISITED (~50k) regardless of
 *     true element count.
 *   - When the per-array cap (MAX_PER_ARRAY = 200) clips the detail list,
 *     the reported COUNTS still reflect true totals (the summary string
 *     plus the new `loadingIndicatorsTotal` field).
 *
 * Each iteration of Codex review on PR #29 turned up another scenario
 * where one of those promises was violated. This file is the regression
 * net for that whole class.
 *
 * Runs against a real Playwright Chromium. setContent() is enough for our
 * fixtures — no network, no Orca, no daemon.
 */

import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { chromium } from "playwright";
import { checkLoadingState } from "../dist/src/wait.js";

let browser;
let page;

before(async () => {
  browser = await chromium.launch();
  const ctx = await browser.newContext();
  page = await ctx.newPage();
});

after(async () => {
  await browser?.close();
});

async function load(html) {
  // domcontentloaded is enough — we don't need network idle for static fixtures.
  await page.setContent(html, { waitUntil: "domcontentloaded" });
}

test("captures <html class='loading'> at the documentElement", async () => {
  await load(`<!doctype html><html class="loading"><body>hi</body></html>`);
  const result = await checkLoadingState(page);
  const root = result.loadingIndicators.find((i) => i.tagName === "html");
  assert.ok(root, `<html class> should be detected, got ${JSON.stringify(result.loadingIndicators)}`);
  assert.equal(result.loadingIndicatorsTotal, 1);
});

test("captures <body class='loading'>", async () => {
  await load(`<!doctype html><html><body class="loading">hi</body></html>`);
  const result = await checkLoadingState(page);
  const body = result.loadingIndicators.find((i) => i.tagName === "body");
  assert.ok(body, `<body class> should be detected, got ${JSON.stringify(result.loadingIndicators)}`);
});

test("captures a deep descendant with a spinner class", async () => {
  await load(`
    <!doctype html><html><body>
      <main><section><article>
        <div class="spinner" id="deep"></div>
      </article></section></main>
    </body></html>
  `);
  const result = await checkLoadingState(page);
  const deep = result.loadingIndicators.find((i) => i.selector === "#deep");
  assert.ok(deep, `deep spinner should be detected, got ${JSON.stringify(result.loadingIndicators)}`);
});

test("aria-busy elements report a true count even past the per-array cap", async () => {
  // 250 [aria-busy="true"] elements; ariaBusyElements detail array caps at 200,
  // but hasAriaBusy / busy COUNT logic in summary stays accurate via querySelectorAll length.
  const items = Array.from({ length: 250 }, () => `<div aria-busy="true"></div>`).join("");
  await load(`<!doctype html><body>${items}</body></html>`);
  const result = await checkLoadingState(page);
  assert.equal(result.hasAriaBusy, true);
  assert.equal(result.ariaBusyElements.length, 200, "detail clipped at MAX_PER_ARRAY");
  assert.match(result.summary, /250 element\(s\) with aria-busy/);
});

test("loadingIndicatorsTotal stays accurate past the array cap", async () => {
  // 250 labeled (aria-label matching /spinner/) + 50 unlabeled (just class="spinner").
  // The aria-label pass runs first, so the first 200 detail slots are the labeled
  // ones; the 50 unlabeled ones get counted by the *-walk but not stored.
  const labeled = Array.from(
    { length: 250 },
    (_, i) => `<div aria-label="spinner-${i}"></div>`,
  ).join("");
  const unlabeled = Array.from({ length: 50 }, () => `<div class="spinner"></div>`).join("");
  await load(`<!doctype html><body>${labeled}${unlabeled}</body></html>`);

  const result = await checkLoadingState(page);
  assert.equal(result.loadingIndicatorsTotal, 300, "totals reflect true count");
  assert.equal(result.loadingIndicators.length, 200, "detail clipped at MAX_PER_ARRAY");
  // Summary should mention BOTH the labeled and unlabeled totals — the bug
  // that started this whole thread was the unlabeled count silently
  // collapsing to whatever happened to be in the (clipped) detail array.
  assert.match(result.summary, /50 loading indicator\(s\) WITHOUT/);
  assert.match(result.summary, /250 loading indicator\(s\) with/);
});

test("MAX_VISITED bounds the *-walk: an indicator past the cap is not found", async () => {
  // ~60k padding divs ahead of one tagged "late" div — well past the 50k
  // visit cap. The late div has no aria-label and no progressbar role, so
  // only the *-walk can find it. If the walk is correctly bounded, it
  // won't be in the detail array AND won't be counted.
  const padding = `<div></div>`.repeat(60_000);
  await load(
    `<!doctype html><body>${padding}<div class="spinner" id="late"></div></body></html>`,
  );
  const result = await checkLoadingState(page);
  const late = result.loadingIndicators.find((i) => i.selector === "#late");
  assert.equal(late, undefined, "late indicator should be past the visit cap");
  assert.equal(
    result.loadingIndicatorsTotal,
    0,
    "no class-only indicator can be counted once the walk is bounded",
  );
});
