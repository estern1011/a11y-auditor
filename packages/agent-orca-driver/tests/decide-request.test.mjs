/**
 * Table-driven test for the unified Host/Origin allow-list.
 *
 * Why this exists: the policy used to be split across isHostAllowed +
 * isOriginAllowed and AND-ed at the call site, which is exactly how a
 * cross-Codespace WS hijack got past review (the two checks were correct
 * in isolation but admitted attacker pairs together). One table here is the
 * regression net for that whole class of bugs.
 *
 * Run via `npm test` from the package root.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decideRequest } from "../dist/src/server.js";

const PORT = 8001;

const cases = [
  // ---- HTTP loopback callers (browser pages on the daemon's own viewer) ----
  {
    name: "loopback host + matching loopback origin: allowed",
    host: "127.0.0.1:8001",
    origin: "http://127.0.0.1:8001",
    expect: { ok: true },
  },
  {
    name: "loopback host + localhost-form origin: allowed",
    host: "localhost:8001",
    origin: "http://localhost:8001",
    expect: { ok: true },
  },
  {
    name: "loopback host + no origin (curl / agent CLI): allowed",
    host: "127.0.0.1:8001",
    origin: undefined,
    expect: { ok: true },
  },

  // ---- The cross-Codespace P1 that started all this ----
  {
    name: "loopback host + Codespaces origin (attacker page → local daemon): rejected",
    host: "127.0.0.1:8001",
    origin: "https://attacker.app.github.dev",
    expect: { ok: false, reason: "bad origin" },
  },
  {
    name: "loopback host + arbitrary cross-site origin: rejected",
    host: "127.0.0.1:8001",
    origin: "https://evil.example.com",
    expect: { ok: false, reason: "bad origin" },
  },

  // ---- Codespaces forwarded callers (operator's browser → forwarded URL) ----
  {
    name: "Codespaces host + matching Codespaces origin: allowed",
    host: "8001-myworkspace.app.github.dev",
    origin: "https://8001-myworkspace.app.github.dev",
    expect: { ok: true },
  },
  {
    name: "Codespaces preview host + matching origin: allowed",
    host: "8001-myworkspace.preview.app.github.dev",
    origin: "https://8001-myworkspace.preview.app.github.dev",
    expect: { ok: true },
  },
  {
    name: "Legacy githubpreview host + matching origin: allowed",
    host: "8001-myworkspace.githubpreview.dev",
    origin: "https://8001-myworkspace.githubpreview.dev",
    expect: { ok: true },
  },
  {
    name: "Codespaces host + different Codespaces origin: rejected (cross-Codespace)",
    host: "8001-mine.app.github.dev",
    origin: "https://8001-attacker.app.github.dev",
    expect: { ok: false, reason: "bad origin" },
  },
  {
    name: "Codespaces host + arbitrary origin: rejected",
    host: "8001-mine.app.github.dev",
    origin: "https://evil.example.com",
    expect: { ok: false, reason: "bad origin" },
  },
  {
    name: "Codespaces host + no origin: allowed",
    host: "8001-mine.app.github.dev",
    origin: undefined,
    expect: { ok: true },
  },

  // ---- Host shenanigans (DNS rebinding, suffix injection, etc.) ----
  {
    name: "missing host: rejected",
    host: undefined,
    origin: undefined,
    expect: { ok: false, reason: "bad host" },
  },
  {
    name: "arbitrary external host: rejected",
    host: "evil.example.com",
    origin: undefined,
    expect: { ok: false, reason: "bad host" },
  },
  {
    name: "suffix injection (attacker.app.github.dev.evil.com): rejected",
    host: "8001-attacker.app.github.dev.evil.com",
    origin: undefined,
    expect: { ok: false, reason: "bad host" },
  },
  {
    name: "Codespaces-shaped host but wrong port: still allowed if shape matches",
    // Host doesn't carry the daemon's port — Codespaces strips it. The Host
    // regex doesn't require a port; this case documents that today's policy
    // trusts shape + auth-gate-at-the-proxy, not the port value.
    host: "9999-foo.app.github.dev",
    origin: undefined,
    expect: { ok: true },
  },

  // ---- Case-insensitivity (Host/Origin are case-insensitive per RFC) ----
  {
    name: "uppercase Host: normalized and allowed",
    host: "127.0.0.1:8001".toUpperCase(),
    origin: "HTTP://127.0.0.1:8001",
    expect: { ok: true },
  },
];

for (const tc of cases) {
  test(tc.name, () => {
    const result = decideRequest(tc.host, tc.origin, PORT);
    if (tc.expect.ok) {
      assert.deepEqual(result, { ok: true });
    } else {
      assert.equal(result.ok, false);
      assert.equal(result.status, 403);
      assert.equal(result.reason, tc.expect.reason);
    }
  });
}
