/**
 * Wire-level security gate tests. The whole point of decideRequest is that
 * the policy holds at the network layer, not just in unit tests — these
 * exercise it against a running daemon using raw http.request (fetch
 * silently strips Host overrides) for HTTP and the `ws` package for WS.
 *
 * Regression net for: cross-Codespace WS hijack (the original P1), naive
 * Host check accepting evil.com, suffix-injection (foo.app.github.dev.evil.com),
 * /navigate scheme leak (file:// / chrome://).
 */

import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { request as httpRequest } from "node:http";
import { WebSocket } from "ws";
import { startDaemon, getJson } from "./harness.mjs";

let d;
before(async () => { d = await startDaemon(); });
after(async () => { await d?.stop(); });

/** Raw HTTP GET with explicit Host + optional Origin. */
function rawGet({ path = "/", host, origin }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: "127.0.0.1",
      port: d.port,
      path,
      method: "GET",
      headers: {
        ...(host !== undefined ? { Host: host } : {}),
        ...(origin !== undefined ? { Origin: origin } : {}),
      },
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

// --- HTTP: host gate ------------------------------------------------------

test("HTTP: loopback Host (matching origin) → 200", async () => {
  const r = await rawGet({ host: `127.0.0.1:${d.port}`, origin: `http://127.0.0.1:${d.port}` });
  assert.equal(r.status, 200);
});

test("HTTP: loopback Host without Origin (curl-style) → 200", async () => {
  const r = await rawGet({ host: `127.0.0.1:${d.port}` });
  assert.equal(r.status, 200);
});

test("HTTP: external Host (evil.com) → 403 'bad host'", async () => {
  const r = await rawGet({ host: "evil.com:8001" });
  assert.equal(r.status, 403);
  assert.match(r.body, /bad host/);
});

test("HTTP: suffix-injection Host (foo.app.github.dev.evil.com) → 403 'bad host'", async () => {
  const r = await rawGet({ host: "8001-foo.app.github.dev.evil.com" });
  assert.equal(r.status, 403);
});

test("HTTP: Codespaces forwarded Host with matching Origin → 200", async () => {
  const host = "8001-myworkspace.app.github.dev";
  const r = await rawGet({ host, origin: `https://${host}` });
  assert.equal(r.status, 200);
});

// --- HTTP: cross-Codespace origin hijack (the P1 that started the chain) -

test("HTTP: loopback Host + attacker Codespaces Origin → 403 'bad origin'", async () => {
  const r = await rawGet({
    host: `127.0.0.1:${d.port}`,
    origin: "https://attacker.app.github.dev",
  });
  assert.equal(r.status, 403);
  assert.match(r.body, /bad origin/);
});

test("HTTP: Codespaces Host + DIFFERENT Codespaces Origin → 403 'bad origin'", async () => {
  const r = await rawGet({
    host: "8001-mine.app.github.dev",
    origin: "https://8001-attacker.app.github.dev",
  });
  assert.equal(r.status, 403);
});

test("HTTP: loopback Host + arbitrary external Origin → 403 'bad origin'", async () => {
  const r = await rawGet({
    host: `127.0.0.1:${d.port}`,
    origin: "https://evil.example.com",
  });
  assert.equal(r.status, 403);
});

// --- WebSocket upgrade: same policy ---------------------------------------

function wsWithHeaders(path, headers = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${d.port}${path}`, { headers });
    let resolved = false;
    const settle = (status) => { if (!resolved) { resolved = true; resolve(status); try { ws.close(); } catch {} } };
    ws.on("open", () => settle("open"));
    ws.on("unexpected-response", (req, res) => settle(`status:${res.statusCode}`));
    ws.on("error", (e) => settle(`error:${e.message}`));
    setTimeout(() => settle("timeout"), 2_000);
  });
}

test("WS /events: no Origin → upgrades (CLI-style consumer)", async () => {
  const r = await wsWithHeaders("/events");
  assert.equal(r, "open");
});

test("WS /events: attacker Codespaces Origin against loopback → 403", async () => {
  const r = await wsWithHeaders("/events", {
    Origin: "https://attacker.app.github.dev",
  });
  assert.equal(r, "status:403");
});

test("WS /stream: arbitrary cross-site Origin → 403", async () => {
  const r = await wsWithHeaders("/stream", {
    Origin: "https://evil.example.com",
  });
  assert.equal(r, "status:403");
});

// --- /navigate URL scheme gate (already unit-tested; verify at the wire) -

test("POST /navigate { url: 'chrome://settings' } → 400", async () => {
  const res = await fetch(d.base + "/navigate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "chrome://settings" }),
  });
  assert.equal(res.status, 400);
});

test("POST /navigate { url: 'javascript:alert(1)' } → 400", async () => {
  const res = await fetch(d.base + "/navigate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "javascript:alert(1)" }),
  });
  assert.equal(res.status, 400);
});

// --- Body size cap --------------------------------------------------------

test("Inbound body > MAX_REQUEST_BODY is rejected (does not reach the handler)", async () => {
  const huge = "x".repeat(2_000_000);
  // The readBody helper calls req.destroy() the moment the cap trips, which
  // closes the socket before any response gets written. fetch sees that as a
  // network error. We accept either form — what we care about is that the
  // daemon did NOT process the oversized payload as if it were valid.
  let outcome;
  try {
    const res = await fetch(d.base + "/perform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: huge }),
    });
    outcome = { kind: "response", status: res.status };
  } catch (e) {
    outcome = { kind: "error", message: String(e?.message || e) };
  }
  if (outcome.kind === "response") {
    assert.ok(outcome.status >= 400, `oversized body must be rejected, got ${outcome.status}`);
  } else {
    assert.match(outcome.message, /fetch failed|socket|reset/i,
      `expected connection-level rejection, got: ${outcome.message}`);
  }
  // Daemon must still be responsive — the rejection shouldn't have killed it.
  const ping = await getJson(d.base + "/").catch(() => null);
  assert.ok(ping && ping.status === 200, "daemon should remain healthy after rejecting an oversized body");
});
