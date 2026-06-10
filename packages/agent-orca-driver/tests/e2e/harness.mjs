/**
 * E2E harness: spawn the daemon (with FakeScreenReaderDriver) in its own
 * process, wait for "Server ready", expose http/ws helpers, kill cleanly.
 *
 * Also owns Xvfb lifecycle for tests that exercise the ffmpeg/x11grab path
 * (the live stream). Tests that don't need a display skip startXvfb().
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, unlinkSync } from "node:fs";

const HARNESS_ROOT = new URL("./", import.meta.url).pathname;

export async function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let xvfbProc = null;

/** Bring up Xvfb on a unique display so the daemon's ffmpeg can grab it. */
export async function startXvfb(display = ":98") {
  const lock = `/tmp/.X${display.slice(1)}-lock`;
  if (existsSync(lock)) {
    try { unlinkSync(lock); } catch {}
  }
  xvfbProc = spawn("Xvfb", [display, "-screen", "0", "1280x1024x24", "-ac"], {
    stdio: "ignore",
  });
  // Wait for X server to come up. xdotool getdisplaygeometry is the obvious
  // probe but it needs xdotool which may not be installed; instead, just
  // poll the lock file (Xvfb creates it once listening).
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (existsSync(lock)) return display;
    await sleep(50);
  }
  throw new Error("Xvfb failed to come up");
}

export async function stopXvfb() {
  if (xvfbProc) {
    try { xvfbProc.kill("SIGTERM"); } catch {}
    xvfbProc = null;
  }
}

/**
 * Start the daemon. Returns { port, base, proc, stop }.
 * `env` is merged into the child env (lets the stream test pass DISPLAY).
 */
export async function startDaemon({ env = {} } = {}) {
  const port = await pickFreePort();
  const cdpPort = await pickFreePort();

  const proc = spawn(
    "node",
    [HARNESS_ROOT + "daemon-runner.mjs"],
    {
      env: {
        ...process.env,
        E2E_PORT: String(port),
        E2E_CDP_PORT: String(cdpPort),
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (d) => { stdout += d.toString(); });
  proc.stderr.on("data", (d) => { stderr += d.toString(); });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (stdout.includes("Server ready")) break;
    if (proc.exitCode !== null) {
      throw new Error(`Daemon exited prematurely (code=${proc.exitCode}):\n${stderr}\n--- stdout ---\n${stdout}`);
    }
    await sleep(50);
  }
  if (!stdout.includes("Server ready")) {
    try { proc.kill("SIGKILL"); } catch {}
    throw new Error(`Daemon did not become ready within 10 s:\n${stderr}\n--- stdout ---\n${stdout}`);
  }

  return {
    port,
    base: `http://127.0.0.1:${port}`,
    proc,
    /** Read accumulated stderr (useful for debugging crashes mid-test). */
    getStderr: () => stderr,
    /** SIGTERM the daemon and wait for it to exit. */
    stop: async () => {
      if (proc.exitCode !== null) return;
      proc.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch {}
          resolve();
        }, 3_000);
        proc.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    },
  };
}

/** Convenience: fetch + JSON parse with helpful errors. */
export async function getJson(url, init = {}) {
  const res = await fetch(url, init);
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}
