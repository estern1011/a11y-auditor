/**
 * HTTP API contract tests against a running daemon. Hits every route
 * documented in AGENTS.md once and verifies the response shape matches the
 * doc. Uses FakeScreenReaderDriver — no Orca / D-Bus / Xvfb needed.
 *
 * This is the "if AGENTS.md says it, the daemon does it" suite. If any of
 * these regress, an orchestrator generated from the doc will break.
 */

import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { startDaemon, getJson } from "./harness.mjs";

let d;
before(async () => { d = await startDaemon(); });
after(async () => { await d?.stop(); });

// --- /  (status) -----------------------------------------------------------

test("GET / returns running status with screen-reader-active flag", async () => {
  const { status, body } = await getJson(d.base + "/");
  assert.equal(status, 200);
  assert.equal(body.status, "running");
  // The field name is mid-rename across the PR stack: #28 emits
  // `voiceoverActive` (v1 compat), #29 was supposed to rename to
  // `screenReaderActive`. The CONTRACT we pin is "some boolean flag for
  // screen-reader liveness is present and true."
  const flag = body.screenReaderActive ?? body.voiceoverActive;
  assert.equal(flag, true, `expected screen-reader-active flag, got: ${JSON.stringify(body)}`);
  assert.ok("currentUrl" in body);
  assert.equal(typeof body.cdpPort, "number");
});

// --- Navigation actions ----------------------------------------------------

test("POST /next returns a VoResponse", async () => {
  const { status, body } = await getJson(d.base + "/next", { method: "POST" });
  assert.equal(status, 200);
  assert.equal(typeof body.spoken, "string");
  assert.equal(typeof body.name, "string");
  assert.equal(typeof body.role, "string");
  assert.ok(Array.isArray(body.state));
  assert.equal(typeof body.index, "number");
});

test("POST /previous returns a VoResponse", async () => {
  const { status, body } = await getJson(d.base + "/previous", { method: "POST" });
  assert.equal(status, 200);
  assert.equal(typeof body.index, "number");
});

test("POST /act returns a VoResponse", async () => {
  const { status, body } = await getJson(d.base + "/act", { method: "POST" });
  assert.equal(status, 200);
  assert.equal(typeof body.spoken, "string");
});

test("POST /enter returns a VoResponse", async () => {
  const { status, body } = await getJson(d.base + "/enter", { method: "POST" });
  assert.equal(status, 200);
  assert.match(body.role, /document/);
});

// --- /perform --------------------------------------------------------------

test("POST /perform without command → 400", async () => {
  const { status, body } = await getJson(d.base + "/perform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(status, 400);
  assert.match(body.error, /command/i);
});

test("POST /perform with valid command → VoResponse", async () => {
  const { status, body } = await getJson(d.base + "/perform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: "FIND_NEXT_HEADING" }),
  });
  assert.equal(status, 200);
  assert.equal(body.name, "FIND_NEXT_HEADING");
});

// --- /press ----------------------------------------------------------------

test("POST /press without key → 400", async () => {
  const { status, body } = await getJson(d.base + "/press", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(status, 400);
  assert.match(body.error, /key/i);
});

test("POST /press accepts modifiers as a string OR an array (AGENTS.md contract)", async () => {
  const a = await getJson(d.base + "/press", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "Tab", modifiers: "shift" }),
  });
  assert.equal(a.status, 200);

  const b = await getJson(d.base + "/press", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "Down", modifiers: ["shift", "ctrl"] }),
  });
  assert.equal(b.status, 200);
});

// --- /navigate -------------------------------------------------------------

test("POST /navigate without url → 400", async () => {
  const { status } = await getJson(d.base + "/navigate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(status, 400);
});

test("POST /navigate with file:// → 400 (scheme allow-list)", async () => {
  const { status, body } = await getJson(d.base + "/navigate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "file:///etc/passwd" }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /scheme/i);
});

test("POST /navigate with https URL → 200, status reflects new currentUrl", async () => {
  const target = "https://example.com/test";
  const { status } = await getJson(d.base + "/navigate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: target }),
  });
  assert.equal(status, 200);
  const status2 = await getJson(d.base + "/");
  assert.equal(status2.body.currentUrl, target);
});

// --- /item-text ------------------------------------------------------------

test("GET /item-text returns a VoResponse", async () => {
  const { status, body } = await getJson(d.base + "/item-text");
  assert.equal(status, 200);
  assert.equal(typeof body.spoken, "string");
});

// --- /transcript -----------------------------------------------------------

test("GET /transcript (no since) returns full buffer + length", async () => {
  const { status, body } = await getJson(d.base + "/transcript");
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.entries));
  assert.equal(typeof body.length, "number");
  assert.ok(body.entries.length > 0, "we POSTed several actions earlier");
});

test("GET /transcript?since=<highest> returns only entries with index > since", async () => {
  const first = await getJson(d.base + "/transcript");
  const lastIdx = first.body.entries[first.body.entries.length - 1].index;
  const { status, body } = await getJson(d.base + `/transcript?since=${lastIdx}`);
  assert.equal(status, 200);
  assert.equal(body.entries.length, 0, "no new entries since last read");

  await fetch(d.base + "/next", { method: "POST" });
  const fresh = await getJson(d.base + `/transcript?since=${lastIdx}`);
  assert.equal(fresh.body.entries.length, 1, "one new entry after /next");
});

test("DELETE /transcript returns { cleared: number }", async () => {
  const { status, body } = await getJson(d.base + "/transcript", { method: "DELETE" });
  assert.equal(status, 200);
  assert.equal(typeof body.cleared, "number");
  assert.ok(body.cleared >= 1);

  const after = await getJson(d.base + "/transcript");
  assert.equal(after.body.entries.length, 0);
});

// --- /audit, /loading-state, /observe, /wait-for-selector ------------------
// All require driver.getPage() to be non-null. The fake driver returns null,
// so we assert the 400 contract: documented routes that need a page MUST 400
// with a clear message when none is open. (Real-page coverage is in
// loading-state.test.mjs which uses Playwright directly.)

for (const path of ["/audit", "/loading-state", "/observe", "/wait-for-selector"]) {
  test(`${path} → 400 when no page open`, async () => {
    const method = path === "/loading-state" ? "GET" : "POST";
    const { status, body } = await getJson(d.base + path, {
      method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify({}) : undefined,
    });
    assert.equal(status, 400);
    assert.match(body.error, /No browser page open/i);
  });
}

// --- /commands -------------------------------------------------------------

test("GET /commands returns the catalog", async () => {
  const { status, body } = await getJson(d.base + "/commands");
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.commands));
  assert.ok(body.commands.length > 0);
});

test("GET /commands?filter= scopes to matching names", async () => {
  const { body } = await getJson(d.base + "/commands?filter=heading");
  assert.ok(body.commands.length > 0);
  assert.ok(body.commands.every((c) => c.toLowerCase().includes("heading")));
});

// --- /live, /live-status ---------------------------------------------------

test("GET /live returns text/html viewer page with anti-framing headers", async () => {
  const res = await fetch(d.base + "/live");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  // Anti-clickjacking: a hostile site that iframes /live can't otherwise
  // be stopped by the request gate (frame navigations often omit Origin),
  // so the browser-enforced framing headers are the real defense.
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.match(res.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  const html = await res.text();
  assert.match(html, /MediaSource/, "viewer references MSE");
  assert.match(html, /\/stream/, "viewer mentions the stream endpoint");
});

test("GET /live-status returns { running, viewers, display }", async () => {
  const { status, body } = await getJson(d.base + "/live-status");
  assert.equal(status, 200);
  assert.equal(typeof body.running, "boolean");
  assert.equal(typeof body.viewers, "number");
  assert.ok("display" in body);
});

// --- /stream + /events (WS routes) plain-HTTP behavior --------------------

test("plain GET /stream returns 404 (WS-only)", async () => {
  const res = await fetch(d.base + "/stream");
  assert.equal(res.status, 404);
});

test("plain GET /events returns 404 (WS-only)", async () => {
  const res = await fetch(d.base + "/events");
  assert.equal(res.status, 404);
});

// --- Unknown route ---------------------------------------------------------

test("Unknown route → 404", async () => {
  const { status, body } = await getJson(d.base + "/nope");
  assert.equal(status, 404);
  assert.match(body.error, /Unknown route/i);
});
