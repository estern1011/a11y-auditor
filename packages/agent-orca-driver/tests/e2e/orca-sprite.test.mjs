/**
 * Sprite e2e: brings up the FULL Orca + AT-SPI2 + Chromium + Xvfb stack with
 * the REAL ScreenReaderDriver (not the fake) and exercises the contract an
 * orchestrator would care about most:
 *
 *   1. /enter focuses into the web area and records a transcript entry.
 *   2. /next advances and records another entry.
 *   3. Transcript entries carry the AT-SPI fields (name + role) — proving
 *      the dbus tree walk in atspi.ts is producing real output, not stubs.
 *   4. /press forwards a keystroke (h for next heading) and the transcript
 *      shows movement.
 *
 * The atspi/speech/core integration path otherwise has zero coverage —
 * everything else in the e2e suite uses the FakeScreenReaderDriver to
 * sidestep these subsystems. If this test passes, the parts of the codebase
 * that "look right in code review" are actually behaving correctly against
 * a real Linux screen reader.
 *
 * Skipped if Orca isn't installed (apt list shown in daemon-runner-orca.mjs
 * for what's required). If it ever runs in CI we'll need a Codespace-style
 * container with the full stack provisioned via `agent-orca-driver setup`.
 */

import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickFreePort, getJson } from "./harness.mjs";

const haveOrca = (() => {
  if (spawnSync("which", ["orca"]).status !== 0) return false;
  const r = spawnSync("orca", ["--version"], { encoding: "utf-8", timeout: 5_000 });
  return r.status === 0 && /^\d/.test((r.stdout || "").trim());
})();
const haveXvfb = spawnSync("which", ["Xvfb"]).status === 0;
const haveDbus = spawnSync("which", ["dbus-launch"]).status === 0;

if (!haveOrca || !haveXvfb || !haveDbus) {
  test("Orca sprite e2e skipped (need apt: orca + xvfb + dbus + at-spi2-core, plus matching Python ABI)", { skip: true });
} else {

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sprite Fixture</title></head>
<body>
  <a href="#main" class="skip">Skip to main</a>
  <nav aria-label="Primary"><a href="/home">Home</a> <a href="/about">About</a></nav>
  <main id="main">
    <h1>Sprite test page</h1>
    <p>This page exercises the real Orca + AT-SPI2 + Chromium pipeline.</p>
    <h2>Section A</h2>
    <p>First paragraph under section A.</p>
    <h2>Section B</h2>
    <button type="button">Sign in</button>
  </main>
</body>
</html>`;

const fixturePath = join(tmpdir(), `orca-sprite-fixture-${process.pid}.html`);
writeFileSync(fixturePath, FIXTURE_HTML);
const fixtureUrl = "file://" + fixturePath;

let daemon;
let dbusProc;

before(async () => {
  // Bring up our own D-Bus session — Codespaces / CI containers usually
  // don't have one. The real driver's `ensureDbus` would fall back to
  // dbus-launch on the daemon side, but doing it here makes the test's
  // environment explicit + reproducible.
  const dbusOutput = spawnSync("dbus-launch", ["--sh-syntax"], { encoding: "utf-8" }).stdout || "";
  const addrMatch = /DBUS_SESSION_BUS_ADDRESS='([^']+)'/.exec(dbusOutput);
  const pidMatch = /DBUS_SESSION_BUS_PID=(\d+)/.exec(dbusOutput);
  if (!addrMatch || !pidMatch) throw new Error("couldn't parse dbus-launch output");
  process.env.DBUS_SESSION_BUS_ADDRESS = addrMatch[1];
  dbusProc = { pid: parseInt(pidMatch[1], 10) };

  const port = await pickFreePort();
  const cdpPort = await pickFreePort();

  daemon = spawn(
    "node",
    [new URL("./daemon-runner-orca.mjs", import.meta.url).pathname],
    {
      env: {
        ...process.env,
        E2E_PORT: String(port),
        E2E_CDP_PORT: String(cdpPort),
        E2E_URL: fixtureUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  daemon.stdout.on("data", (d) => { stdout += d.toString(); });
  daemon.stderr.on("data", (d) => { stderr += d.toString(); });

  // Orca + Chromium startup is slow — give it up to 60 s. If we don't see
  // "Server ready" by then, dump the logs into the test output so the
  // failure is debuggable.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (stdout.includes("Server ready")) break;
    if (daemon.exitCode !== null) {
      throw new Error(`Daemon exited early (code=${daemon.exitCode}):\n${stderr}\n--- stdout ---\n${stdout}`);
    }
    await sleep(200);
  }
  if (!stdout.includes("Server ready")) {
    try { daemon.kill("SIGKILL"); } catch {}
    throw new Error(`Daemon didn't become ready within 60 s:\n${stderr}\n--- stdout ---\n${stdout}`);
  }

  daemon.base = `http://127.0.0.1:${port}`;
  // After /enter is automatic on URL load (server.ts startServer), give Orca
  // a beat to settle into browse mode before the test exercises /next.
  await sleep(2_000);
});

after(async () => {
  if (daemon && daemon.exitCode === null) {
    daemon.kill("SIGTERM");
    await new Promise((resolve) => {
      const t = setTimeout(() => { try { daemon.kill("SIGKILL"); } catch {} resolve(); }, 5_000);
      daemon.once("exit", () => { clearTimeout(t); resolve(); });
    });
  }
  if (dbusProc?.pid) {
    try { process.kill(dbusProc.pid); } catch {}
  }
  if (existsSync(fixturePath)) {
    try { unlinkSync(fixturePath); } catch {}
  }
});

test("GET / reports screenReaderActive against the real Orca driver", async () => {
  const { status, body } = await getJson(daemon.base + "/");
  assert.equal(status, 200);
  assert.equal(body.status, "running");
  // The rename to screenReaderActive lives on #29; on #28 the response field
  // is still voiceoverActive (driver internal is already screenReaderActive,
  // server's HTTP shape is the v1-compat name). Accept either.
  const flag = body.screenReaderActive ?? body.voiceoverActive;
  assert.equal(flag, true, "Orca should be running");
});

test("explicit POST /enter records a transcript entry with real AT-SPI fields", async () => {
  // The auto-/enter that startServer does on the URL-load path doesn't
  // reliably produce a transcript entry — Orca is still booting browse
  // mode when it fires. The CONTRACT we pin is that an explicit /enter
  // (Loop 1 in AGENTS.md) does. Clear the buffer first so we know the
  // entry we count belongs to THIS call.
  await getJson(daemon.base + "/transcript", { method: "DELETE" });

  const enter = await getJson(daemon.base + "/enter", { method: "POST" });
  assert.equal(enter.status, 200);
  assert.equal(typeof enter.body.spoken, "string");
  assert.equal(typeof enter.body.name, "string");
  assert.equal(typeof enter.body.role, "string");

  const { body } = await getJson(daemon.base + "/transcript");
  assert.ok(body.entries.length >= 1, `expected at least one entry after /enter, got: ${JSON.stringify(body.entries)}`);
  const first = body.entries[0];
  assert.ok(first.spoken.length > 0 || first.name.length > 0,
    "either spoken or name must carry content from the real AT-SPI/Orca path");
});

test("POST /next advances Orca and records a new transcript entry", async () => {
  const before = await getJson(daemon.base + "/transcript");
  const beforeLen = before.body.entries.length;

  const next = await getJson(daemon.base + "/next", { method: "POST" });
  assert.equal(next.status, 200);
  assert.equal(typeof next.body.spoken, "string");
  assert.equal(typeof next.body.role, "string");

  const after = await getJson(daemon.base + "/transcript");
  assert.ok(
    after.body.entries.length > beforeLen,
    `/next should have grown the transcript: before=${beforeLen}, after=${after.body.entries.length}`,
  );
});

test("POST /press {key:'h'} performs heading nav and records a new entry", async () => {
  const before = await getJson(daemon.base + "/transcript");
  const beforeLen = before.body.entries.length;

  const r = await getJson(daemon.base + "/press", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "h" }),
  });
  assert.equal(r.status, 200);

  const after = await getJson(daemon.base + "/transcript");
  assert.ok(
    after.body.entries.length > beforeLen,
    `/press 'h' should record a transcript entry (Orca's heading quick-nav): before=${beforeLen}, after=${after.body.entries.length}`,
  );
});

test("POST /perform SAY_ALL actually invokes Orca (Super modifier override fires)", async () => {
  // This test is the contract for the modifier override in speech.ts.
  // SAY_ALL is keyed as Super+;  but Orca's default orcaModifierKeys is
  // ["Insert", "KP_Insert"] — without our pre-seeded user-settings.conf
  // forcing Super_L/Super_R, the keypress would bypass Orca entirely and
  // be received by the BROWSER (silent no-op for SAY_ALL specifically;
  // an "h" character for the heading nav etc.).
  //
  // Detection: SAY_ALL re-announces the document content from the current
  // position. A successful invocation produces transcript entries with
  // SOMETHING in them after the call; a missed modifier leaves the
  // transcript flat. We assert ≥1 new entry within a generous window.
  const before = await getJson(daemon.base + "/transcript");
  const beforeLen = before.body.entries.length;

  const r = await getJson(daemon.base + "/perform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: "SAY_ALL" }),
  });
  assert.equal(r.status, 200, `SAY_ALL should return 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert.ok(!("error" in r.body), `SAY_ALL should not error: ${JSON.stringify(r.body)}`);

  // SAY_ALL streams over time; the synchronous response captures only the
  // current focus. Poll transcript for the actual announcements.
  let after;
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    after = await getJson(daemon.base + "/transcript");
    if (after.body.entries.length > beforeLen) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(
    after.body.entries.length > beforeLen,
    `SAY_ALL should produce new transcript entries within 4 s — the modifier override either isn't being read or Orca didn't bind Super+; to say-all (before=${beforeLen}, after=${after.body.entries.length})`,
  );
});

}
