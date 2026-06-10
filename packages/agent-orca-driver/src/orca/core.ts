/**
 * Core Orca operations, state, and Chromium lifecycle for Linux.
 *
 * Uses:
 * - Orca screen reader (GNOME's built-in AT)
 * - Speech capture via orca-customizations.py hook (speech.ts)
 * - AT-SPI2 via D-Bus for accessibility tree queries (atspi.ts)
 * - AT-SPI2 GenerateKeyboardEvent for key injection (not xdotool)
 * - xdotool only for X11 window focus management
 * - Playwright for Chromium lifecycle
 *
 * Other modules (server, CLI) import from here — never from AT-SPI2 directly.
 *
 * ===========================================================================
 * DAEMON STATE MACHINE
 * ===========================================================================
 *
 * The module is a singleton state machine with four lifecycle states. Every
 * exported function checks or transitions a substate; the operation lock
 * ensures only one transition runs at a time.
 *
 *      uninitialized                 ← module load. No Xvfb, no Orca, no page.
 *           │
 *           │  initialize(url, cdpPort)
 *           │  • ensureDesktopEnv (Xvfb, openbox, dbus, at-spi2, pulse)
 *           │  • chromium.launch  (headless: false)
 *           │  • startOrca / isOrcaRunning (own vs. inherit)
 *           │  • ORCA_STATE_FILE persists weStartedOrca for cleanup
 *           ▼
 *        running                     ← every /next /press /perform path
 *           │
 *           │  cleanup() [SIGINT/SIGTERM/explicit]
 *           │  • drains the operation lock first  (await operationLock)
 *           │  • disconnects atspi D-Bus
 *           │  • closes the Playwright browser
 *           │  • stops Orca ONLY if weStartedOrca (don't kill user's running session)
 *           │  • SIGTERMs Xvfb/at-spi2 children if we started them
 *           ▼
 *      shuttingDown                  ← lock flag, no new ops accepted
 *           │
 *           ▼
 *        exited                      ← runtime/PID files removed
 *
 * ===========================================================================
 * INVARIANTS
 * ===========================================================================
 *
 * I1. ONE operation in flight at a time.
 *     `operationLock` serializes everything that touches Orca or AT-SPI2.
 *     Without this, two parallel /next calls would race on the speech log
 *     marker AND on Orca's own keyboard-input queue. The lock is a chain of
 *     promises — each new op waits on the previous, attaches itself, then
 *     releases.
 *
 * I2. SHUTTING DOWN is one-way.
 *     Once `shuttingDown = true`, withLock() rejects new ops with "Driver
 *     is shutting down." The cleanup() function awaits the existing lock
 *     before tearing down, so the LAST in-flight op finishes; no new op
 *     can sneak in to mutate state behind cleanup().
 *
 * I3. weStartedOrca decides cleanup scope.
 *     If Orca was already running when initialize() ran (someone else owns
 *     it — e.g. the user's normal desktop session), we don't kill it on
 *     shutdown. The persisted ORCA_STATE_FILE survives daemon crashes so
 *     a future `agent-orca-driver stop` can know whether to stop Orca.
 *
 * I4. Transcript is append-only-with-rolling-cap.
 *     recordTranscript() pushes; the buffer is sliced to the last
 *     MAX_TRANSCRIPT_ENTRIES on overflow. transcriptIndex is a global
 *     monotonic counter, NOT array length — survives buffer rolls AND
 *     DELETE /transcript (callers paginate by highest-index-seen, not by
 *     position).
 *
 * I5. Every spawned helper is owned and reaped — via ONE registry.
 *     `ownedHelpers` records {name, pid} for each desktop helper WE
 *     spawned (Xvfb, openbox, dbus-daemon, at-spi2); cleanup() kills
 *     them in reverse spawn order. Inherited infrastructure (existing
 *     DISPLAY / DBUS_SESSION_BUS_ADDRESS / running WM) is never
 *     registered, so it's never touched. Two helpers need bespoke
 *     ownership: Orca (orcaPid + weStartedOrca, killed via stopOrca)
 *     and PulseAudio (self-daemonizing, so `weStartedPulse` +
 *     `pulseaudio --kill`). If you add a spawn site, call trackHelper()
 *     or give it an explicit ownership story — untracked spawns leak
 *     across daemon restarts.
 *
 * ===========================================================================
 * WHAT'S NOT COVERED HERE
 * ===========================================================================
 *
 * • The HTTP API surface lives in src/server.ts, which translates routes
 *   to driver method calls on this module via the ScreenReaderDriver
 *   interface (src/interface.ts). Nothing in this file knows about HTTP.
 *
 * • The fMP4 stream pipeline (src/live/stream.ts) reads the X framebuffer
 *   that THIS module spawned but otherwise runs independently. Its own
 *   state machine is documented in that file's header.
 *
 * • The speech-capture hook (src/orca/speech.ts) writes a customizations
 *   .py file that Orca loads on startup; this module's startOrca() expects
 *   ensureSpeechCapture() to have run BEFORE Orca is spawned, otherwise
 *   the customizations don't take effect until the next Orca restart.
 */

import { spawn, spawnSync, execSync } from "child_process";
import { existsSync, unlinkSync } from "fs";
import { runtimePath, safeWriteSync, safeAppendSync } from "../lib/runtime-paths.js";
import { chromium } from "playwright";
import type { Page, Browser } from "playwright";
import { translateError } from "../errors.js";
import {
  type VoResponse,
  type VoResult,
  type TranscriptEntry,
  ORCA_COMMANDS,
} from "../types.js";
import * as speech from "./speech.js";
import * as atspi from "./atspi.js";
import { liveEvents } from "../live/events.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const DEFAULT_PORT = 8001;
export const DEFAULT_CDP_PORT = 9223;
export const LOG_FILE = runtimePath("driver.log");
export const PID_FILE = runtimePath("driver.pid");
export const ORCA_STATE_FILE = runtimePath("driver-state.json");

export const CLI_TIMEOUT_MS = 30_000;
export const MAX_TRANSCRIPT_ENTRIES = 10_000;
export const MAX_REQUEST_BODY = 1_000_000;

const ORCA_SETTLE_MS = 1000;
const ORCA_QUICK_SETTLE_MS = 400;
const ORCA_PRESS_SETTLE_MS = 1000;
const ORCA_INIT_SETTLE_MS = 5000;

// Desktop helpers WE spawned, in spawn order. cleanup() kills them in
// reverse order (registry daemons before the X server they talk to).
// Every spawn-a-helper path MUST register here — this registry replaced
// per-helper module variables (xvfbProc, openboxProc, dbusPid, ...) after
// three separate review rounds each found one more spawned-but-untracked
// helper. One list, one kill loop: a new helper can't forget cleanup
// without also being visibly absent from its trackHelper() call.
interface OwnedHelper {
  name: string;
  pid: number;
}
let ownedHelpers: OwnedHelper[] = [];

function trackHelper(name: string, pid: number | null | undefined): void {
  if (pid) ownedHelpers.push({ name, pid });
}

let orcaPid: number | null = null;
let weStartedPulse = false;

// ---------------------------------------------------------------------------
// Operation lock — serializes all Orca operations
// ---------------------------------------------------------------------------

let operationLock: Promise<void> = Promise.resolve();
let shuttingDown = false;

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (shuttingDown) return Promise.reject(new Error("Driver is shutting down"));
  const prev = operationLock;
  let resolveLock!: () => void;
  const next = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  operationLock = next;
  return prev.then(fn).finally(resolveLock);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function errorMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function removePidFile() {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {}
  try {
    if (existsSync(ORCA_STATE_FILE)) unlinkSync(ORCA_STATE_FILE);
  } catch {}
}

/** Strip non-printable characters that leak from modifier key release events. */
function cleanSpoken(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim();
}

function deduplicateSpoken(text: string): string {
  const parts = text.split(/\s+/);
  const deduped: string[] = [];
  for (const part of parts) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== part) {
      deduped.push(part);
    }
  }
  return deduped.join(" ");
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface DriverState {
  orcaActive: boolean;
  weStartedOrca: boolean;
  currentUrl: string | null;
  browser: Browser | null;
  page: Page | null;
  cdpPort: number;
  transcript: TranscriptEntry[];
  transcriptIndex: number;
  browserPid: number | null;
}

const state: DriverState = {
  orcaActive: false,
  weStartedOrca: false,
  currentUrl: null,
  browser: null,
  page: null,
  cdpPort: DEFAULT_CDP_PORT,
  transcript: [],
  transcriptIndex: 0,
  browserPid: null,
};

export function getPage(): Page | null {
  return state.page;
}

export function getStatus(): { orcaActive: boolean; currentUrl: string | null; cdpPort: number } {
  return { orcaActive: state.orcaActive, currentUrl: state.currentUrl, cdpPort: state.cdpPort };
}

export function getTranscriptLength(): number {
  return state.transcript.length;
}

/**
 * Cursor for incremental polling: pass this back as `?since=<cursor>` and
 * get only entries with higher indexes. Equals the highest assigned entry
 * index, which equals `transcriptIndex - 1` since recordTranscript uses
 * post-increment. Returns -1 if nothing has been recorded yet, so a fresh
 * caller can use `since=-1` to receive the entire buffer including the
 * very first entry (index 0).
 *
 * Crucially this is NOT `state.transcript.length`. After DELETE /transcript
 * the buffer is empty but transcriptIndex keeps growing, and after the
 * buffer rolls past MAX_TRANSCRIPT_ENTRIES the length is the cap while
 * indexes keep advancing — using length as the cursor would skip entries
 * in both cases.
 */
export function getTranscriptCursor(): number {
  return state.transcriptIndex - 1;
}

// ---------------------------------------------------------------------------
// Logging & transcript
// ---------------------------------------------------------------------------

export function log(msg: string, err = false) {
  const line = `[${new Date().toISOString()}] [${err ? "ERROR" : "INFO"}] ${msg}\n`;
  try {
    safeAppendSync(LOG_FILE, line);
  } catch {}
}

// Per-field char cap on each transcript entry. A hostile page can put a
// megabyte-long aria-label on a focusable element; Orca will read it, and
// AT-SPI2 will hand it back as `name`. Truncate so a single entry can't
// dominate the response or the in-memory buffer.
const MAX_TRANSCRIPT_FIELD_CHARS = 4_000;
function capField(value: string): string {
  return value.length > MAX_TRANSCRIPT_FIELD_CHARS
    ? value.slice(0, MAX_TRANSCRIPT_FIELD_CHARS) + "\u2026"
    : value;
}

function recordTranscript(entry: VoResponse): TranscriptEntry {
  const indexed: TranscriptEntry = {
    spoken: capField(entry.spoken),
    name: capField(entry.name),
    role: capField(entry.role),
    state: entry.state,
    index: state.transcriptIndex++,
  };
  state.transcript.push(indexed);
  if (state.transcript.length > MAX_TRANSCRIPT_ENTRIES) {
    state.transcript = state.transcript.slice(-MAX_TRANSCRIPT_ENTRIES);
  }
  return indexed;
}

export function getTranscript(since?: number): TranscriptEntry[] {
  if (since !== undefined) return state.transcript.filter((e) => e.index > since);
  return [...state.transcript];
}

export function clearTranscript(): TranscriptEntry[] {
  const entries = [...state.transcript];
  state.transcript = [];
  return entries;
}

// ---------------------------------------------------------------------------
// Speech + AT-SPI2 combined element reading
// ---------------------------------------------------------------------------

async function readCurrentElement(speechMarker: number): Promise<VoResponse> {
  speech.flush();
  let spoken = cleanSpoken(deduplicateSpoken(speech.spokenSince(speechMarker)));

  let name = "",
    role = "",
    elementState: string[] = [];
  let bbox: { x: number; y: number; w: number; h: number } | undefined;
  try {
    const element = await atspi.getItemInfo();
    if (element) {
      name = element.name;
      role = element.role;
      bbox = element.bbox;
      elementState = element.state.filter((s) =>
        [
          "focused",
          "checked",
          "expanded",
          "collapsed",
          "selected",
          "required",
          "visited",
          "pressed",
          "has-popup",
        ].includes(s),
      );
    }
  } catch (e) {
    log(`AT-SPI2 query: ${errorMsg(e)}`, true);
  }

  if (!spoken) spoken = [name, role].filter(Boolean).join(", ");

  // Feed the live view's focus rectangle (no-op if no viewer is connected).
  try {
    liveEvents.emitFocus({ role, name, bbox });
  } catch {
    /* never let the live view break a read */
  }

  return { spoken, name, role, state: elementState };
}

// ---------------------------------------------------------------------------
// Key name mapping
// ---------------------------------------------------------------------------

const KEY_MAP: Record<string, string> = {
  Return: "Return",
  Enter: "Return",
  Space: "space",
  Escape: "Escape",
  Tab: "Tab",
  Left: "Left",
  Right: "Right",
  Down: "Down",
  Up: "Up",
  Delete: "Delete",
  Backspace: "BackSpace",
  Home: "Home",
  End: "End",
  PageUp: "Prior",
  PageDown: "Next",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
};

const MODIFIER_MAP: Record<string, string> = {
  control: "ctrl",
  ctrl: "ctrl",
  shift: "shift",
  alt: "alt",
  option: "alt",
  super: "super",
  meta: "super",
  command: "super",
};

export const VALID_MODIFIERS: Record<string, string> = {
  control: "ctrl",
  ctrl: "ctrl",
  shift: "shift",
  alt: "alt",
  super: "super",
};

function resolveKey(key: string): string {
  return KEY_MAP[key] || key;
}

function resolveModifiers(mods: string[]): string[] {
  return mods.map((m) => {
    const resolved = MODIFIER_MAP[m.toLowerCase()];
    if (!resolved)
      throw new Error(`Unknown modifier: ${m}. Valid: ${Object.keys(VALID_MODIFIERS).join(", ")}`);
    return resolved;
  });
}

async function sendKey(key: string, modifiers: string[] = []) {
  await atspi.generateKeyboardEvent(key, modifiers);
}

// ---------------------------------------------------------------------------
// Virtual desktop bootstrap
// ---------------------------------------------------------------------------

function ensureDisplay(): void {
  if (process.env.DISPLAY) {
    log(`Using existing display: ${process.env.DISPLAY}`);
    return;
  }

  try {
    execSync("which Xvfb", { stdio: "pipe" });
  } catch {
    throw new Error("No DISPLAY set and Xvfb not found. Run: agent-orca-driver setup");
  }

  try {
    execSync("xdotool getdisplaygeometry", {
      stdio: "pipe",
      timeout: 3000,
      env: { ...process.env, DISPLAY: ":99" },
    });
    process.env.DISPLAY = ":99";
    log("Using existing Xvfb on :99");
    return;
  } catch {}

  try {
    execSync("rm -f /tmp/.X99-lock", { stdio: "pipe" });
  } catch {}

  log("Starting Xvfb on :99...");
  const xvfbProc = spawn("Xvfb", [":99", "-screen", "0", "1280x1024x24", "-ac"], {
    stdio: "pipe",
    detached: true,
  });
  xvfbProc.unref();
  trackHelper("Xvfb", xvfbProc.pid);

  const start = Date.now();
  while (Date.now() - start < 3000) {
    try {
      execSync("xdotool getdisplaygeometry", {
        stdio: "pipe",
        timeout: 1000,
        env: { ...process.env, DISPLAY: ":99" },
      });
      process.env.DISPLAY = ":99";
      log(`Xvfb started on :99 (PID: ${xvfbProc.pid})`);
      return;
    } catch {
      spawnSync("sleep", ["0.3"]);
    }
  }
  throw new Error("Xvfb failed to start on :99");
}

function ensureWindowManager(): void {
  // Check for a WM on OUR display, not globally. A previous version used
  // `pgrep -x openbox`, which returned success when ANY openbox was running
  // (typically the user's openbox on :0 / their real session). We'd skip
  // spawning one for :99 and Chromium ended up unmanaged — xdotool
  // windowfocus and the focus-into-web-area click both got flaky.
  // _NET_SUPPORTING_WM_CHECK is the EWMH property a conformant WM sets on
  // the root window when it claims a display; absence means no WM here.
  const display = process.env.DISPLAY;
  if (display) {
    try {
      const r = spawnSync("xprop", ["-root", "_NET_SUPPORTING_WM_CHECK"], {
        env: { ...process.env, DISPLAY: display },
        encoding: "utf-8",
        timeout: 2_000,
      });
      if (r.status === 0 && /window id/i.test(r.stdout || "")) {
        log(`Window manager already running on ${display}`);
        return;
      }
    } catch {
      // xprop may not be installed; fall through and just try to start one
    }
  }

  try {
    execSync("which openbox", { stdio: "pipe" });
  } catch {
    log("openbox not found — window focus may not work", true);
    return;
  }

  // Track for cleanup. When DISPLAY points at a pre-existing Xvfb we don't
  // own (CI reusing :99 across runs), killing Xvfb on shutdown wouldn't
  // take this openbox down with it; untracked, the WM lingers on the
  // display for every subsequent session.
  const openboxProc = spawn("openbox", [], { stdio: "ignore", detached: true, env: process.env });
  openboxProc.unref();
  trackHelper("openbox", openboxProc.pid);
  spawnSync("sleep", ["0.5"]);
  log(`Started openbox window manager on ${display || "default display"} (PID: ${openboxProc.pid})`);
}

function ensureDbus(): void {
  if (process.env.DBUS_SESSION_BUS_ADDRESS) {
    log(`Using existing D-Bus: ${process.env.DBUS_SESSION_BUS_ADDRESS}`);
    return;
  }

  const result = execSync("dbus-launch --sh-syntax", { encoding: "utf-8" });
  const match = /DBUS_SESSION_BUS_ADDRESS='([^']+)'/.exec(result);
  if (!match) throw new Error("dbus-launch output not parseable");
  process.env.DBUS_SESSION_BUS_ADDRESS = match[1];
  // dbus-launch also emits `DBUS_SESSION_BUS_PID=<pid>;` — capture it so
  // cleanup() can stop the daemon we spawned. Without this the private
  // dbus-daemon outlives the driver on every shutdown / initialize failure.
  const pidMatch = /DBUS_SESSION_BUS_PID=(\d+)/.exec(result);
  if (pidMatch) {
    const dbusPid = parseInt(pidMatch[1], 10);
    trackHelper("dbus-daemon", dbusPid);
    log(`D-Bus started: ${match[1]} (PID: ${dbusPid})`);
  } else {
    log(`D-Bus started: ${match[1]} (no PID in output — won't be cleaned up)`, true);
  }
}

function ensureAtSpi2(): void {
  for (const [name, bins] of [
    [
      "at-spi-bus-launcher",
      ["/usr/libexec/at-spi-bus-launcher", "/usr/lib/at-spi2-core/at-spi-bus-launcher"],
    ],
    [
      "at-spi2-registryd",
      ["/usr/libexec/at-spi2-registryd", "/usr/lib/at-spi2-core/at-spi2-registryd"],
    ],
  ] as const) {
    try {
      const bin =
        bins.find((b) => {
          try {
            execSync(`test -x ${b}`, { stdio: "pipe" });
            return true;
          } catch {
            return false;
          }
        }) || bins[0];
      const proc = spawn(bin, [], { stdio: "ignore", detached: true, env: process.env });
      proc.unref();
      trackHelper(name, proc.pid);
      log(`${name} started`);
    } catch (e) {
      log(`${name}: ${errorMsg(e)} (may already be running)`);
    }
  }
}

function ensureAudioSink(): void {
  try {
    execSync("which pulseaudio", { stdio: "pipe" });
  } catch {
    process.env.PULSE_SERVER = "none";
    log("No PulseAudio, set PULSE_SERVER=none");
    return;
  }

  try {
    // Run --check and --start as SEPARATE commands (not `--check || --start`)
    // so we know which branch happened. pulseaudio --start self-daemonizes,
    // so there's no child PID to track — `weStartedPulse` + `pulseaudio
    // --kill` in cleanup() is the ownership mechanism. With
    // --exit-idle-time=-1 the daemon never exits on its own, so an
    // untracked start leaked it permanently.
    let pulseRunning = true;
    try {
      execSync("pulseaudio --check", { stdio: "pipe" });
    } catch {
      pulseRunning = false;
    }
    if (!pulseRunning) {
      execSync("pulseaudio --start --exit-idle-time=-1", { stdio: "pipe" });
      weStartedPulse = true;
    }
    execSync("pactl load-module module-null-sink sink_name=dummy 2>/dev/null || true", {
      stdio: "pipe",
    });
    log(
      pulseRunning
        ? "PulseAudio already running, ensured null sink"
        : "PulseAudio started with null sink",
    );
  } catch (e) {
    process.env.PULSE_SERVER = "none";
    log(`PulseAudio failed (${errorMsg(e)}), set PULSE_SERVER=none`);
  }
}

function ensureDesktopEnv(): void {
  if (process.env.NO_AT_BRIDGE) {
    delete process.env.NO_AT_BRIDGE;
    log("Unset NO_AT_BRIDGE");
  }
  if (!process.env.GTK_MODULES?.includes("atk-bridge")) {
    process.env.GTK_MODULES = "gail:atk-bridge";
    log("Set GTK_MODULES=gail:atk-bridge");
  }
  ensureDisplay();
  ensureWindowManager();
  ensureDbus();
  ensureAtSpi2();
  ensureAudioSink();
}

// ---------------------------------------------------------------------------
// Orca process management
// ---------------------------------------------------------------------------

function isOrcaRunning(): boolean {
  try {
    return spawnSync("pgrep", ["-x", "orca"]).status === 0;
  } catch {
    return false;
  }
}

function startOrca(): boolean {
  if (isOrcaRunning()) {
    log("Orca already running");
    return false;
  }
  // XDG_DATA_HOME isolates this Orca's data directory from the user's
  // `~/.local/share/orca/`. Orca resolves
  // `$XDG_DATA_HOME/orca/orca-customizations.py` for its hook file —
  // speech.ts writes ours into the isolated location. Without this env
  // override, our monkey-patch would land in the user's home dir and
  // could leak into their later desktop screen-reader session.
  const proc = spawn("orca", [], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, XDG_DATA_HOME: speech.getOrcaXdgDataHome() },
  });
  proc.unref();
  orcaPid = proc.pid ?? null;
  log(`Started Orca (PID: ${orcaPid}, XDG_DATA_HOME: ${speech.getOrcaXdgDataHome()})`);
  return true;
}

function stopOrca() {
  // SIGTERM the PID we spawned rather than `pkill -x orca`. If the user
  // started a second Orca during the daemon's lifetime (e.g. they turned on
  // their desktop accessibility tools mid-session), a global pkill would
  // take that one out too — even though weStartedOrca is supposed to scope
  // cleanup to the process we own.
  if (orcaPid == null) {
    log("stopOrca: no tracked Orca PID, skipping");
    return;
  }
  try {
    process.kill(orcaPid);
    log(`Stopped Orca (PID: ${orcaPid})`);
  } catch (e) {
    // ESRCH (already exited) is fine; anything else is worth logging.
    log(`Failed to stop Orca (PID: ${orcaPid}): ${errorMsg(e)}`, true);
  }
  orcaPid = null;
}

// ---------------------------------------------------------------------------
// Orca operations
// ---------------------------------------------------------------------------

async function orcaAction(keyName: string, modifiers: string[] = []): Promise<TranscriptEntry> {
  const marker = speech.mark();
  await sendKey(resolveKey(keyName), resolveModifiers(modifiers));
  await sleep(ORCA_SETTLE_MS);
  return recordTranscript(await readCurrentElement(marker));
}

function lockedOrcaAction(keyName: string, modifiers: string[] = []): Promise<VoResult> {
  return withLock(async () => {
    try {
      return await orcaAction(keyName, modifiers);
    } catch (e) {
      return translateError(e);
    }
  });
}

export function orcaNext(): Promise<VoResult> {
  return lockedOrcaAction("Down");
}
export function orcaPrevious(): Promise<VoResult> {
  return lockedOrcaAction("Up");
}
export function orcaAct(): Promise<VoResult> {
  return lockedOrcaAction("Return");
}

export async function orcaPerform(commandName: string): Promise<VoResult> {
  return withLock(async () => {
    const entry = ORCA_COMMANDS[commandName];
    if (!entry) return translateError(`Unknown command: ${commandName}`, { command: commandName });
    try {
      const marker = speech.mark();
      await sendKey(resolveKey(entry.key), resolveModifiers(entry.modifiers || []));
      await sleep(entry.settle || ORCA_SETTLE_MS);
      return recordTranscript(await readCurrentElement(marker));
    } catch (e) {
      return translateError(e, { command: commandName });
    }
  });
}

export async function orcaPress(key: string, modifiers: string[] = []): Promise<VoResult> {
  return withLock(async () => {
    const unknown = modifiers.filter((m) => !MODIFIER_MAP[m.toLowerCase()]);
    if (unknown.length)
      return translateError(`Unknown modifier(s): ${unknown.join(", ")}`, { key });
    try {
      const marker = speech.mark();
      await sendKey(resolveKey(key), resolveModifiers(modifiers));
      await sleep(ORCA_PRESS_SETTLE_MS);
      return recordTranscript(await readCurrentElement(marker));
    } catch (e) {
      return translateError(e, { key });
    }
  });
}

// ---------------------------------------------------------------------------
// Browser lifecycle
// ---------------------------------------------------------------------------

async function focusBrowser() {
  try {
    const searchArgs = state.browserPid
      ? ["search", "--pid", state.browserPid.toString()]
      : ["search", "--name", "Chrome"];
    const result = spawnSync("xdotool", searchArgs, {
      encoding: "utf-8",
      timeout: 5000,
      env: process.env,
    });
    const windowId = (result.stdout || "").trim().split("\n")[0];
    if (windowId) {
      spawnSync("xdotool", ["windowfocus", "--sync", windowId], {
        timeout: 5000,
        env: process.env,
      });
      await sleep(ORCA_QUICK_SETTLE_MS);
    }
    // Click the center of the screen to focus web content (Chrome is maximized).
    // This real X11 click triggers an AT-SPI2 focus event on the web document,
    // which causes Orca to enter browse mode AND announce the page/element it
    // landed on. The CALLER is responsible for the speech buffer (clear +
    // mark before calling, read after the sleep below) — focusBrowser used
    // to clear() at the end, which discarded the very announcement we want
    // to capture for /navigate and /enter.
    spawnSync("xdotool", ["mousemove", "640", "600", "click", "1"], {
      timeout: 5000,
      env: process.env,
    });
    await sleep(ORCA_SETTLE_MS);
  } catch (e) {
    log(`focus warning: ${errorMsg(e)}`);
  }
}

export async function initialize(url: string | null, cdpPort: number) {
  state.cdpPort = cdpPort;

  // Detect pre-existing Orca BEFORE bootstrapping the desktop env. `pgrep -x
  // orca` doesn't need a display, and bailing here avoids leaving Xvfb /
  // openbox / dbus / at-spi2 / pulse running on an SSH/headless session when
  // the guard below throws. On a real desktop where the user has Orca as
  // their screen reader, this is THEIR session; refuse by default and
  // require an explicit opt-in so we don't silently destroy their
  // accessibility setup. (Earlier versions auto-killed via speech.ts; that
  // defeated the weStartedOrca cleanup guard AND broke the user's session
  // in one go.)
  const preExistingOrca = isOrcaRunning();
  if (preExistingOrca && process.env.AGENT_ORCA_DRIVER_TAKEOVER !== "1") {
    throw new Error(
      "Orca is already running. The daemon needs to own its Orca process.\n" +
        "Either stop your Orca session first (e.g. `pkill -x orca`) and re-run,\n" +
        "or set AGENT_ORCA_DRIVER_TAKEOVER=1 to let the daemon kill+restart it\n" +
        "(your session will not be restored on daemon shutdown).",
    );
  }

  // From here on, any failure must clean up the helpers we just spawned —
  // Xvfb/openbox/dbus/at-spi2/pulse from ensureDesktopEnv, plus Chromium and
  // Orca if those got partway. startServer doesn't wrap initialize() in
  // cleanup(), so a Chromium-launch or Orca-start failure would otherwise
  // leak a full desktop stack on every retry.
  try {
    ensureDesktopEnv();

    if (preExistingOrca) {
      log("AGENT_ORCA_DRIVER_TAKEOVER=1 — killing pre-existing Orca session", true);
      try {
        execSync("pkill -x orca", { stdio: "pipe" });
      } catch {}
      // Give Orca a beat to actually exit before we proceed.
      await sleep(500);
    }

    speech.ensureSpeechCapture(log);
    await sleep(1000);

    state.browser = await chromium.launch({
      headless: false,
      args: [
        `--remote-debugging-port=${cdpPort}`,
        "--remote-debugging-address=127.0.0.1",
        "--force-renderer-accessibility",
        "--start-maximized",
      ],
    });
    const ctx = await state.browser.newContext({ viewport: { width: 1280, height: 1024 } });
    state.page = await ctx.newPage();

    try {
      const proc = (state.browser as any)?.process?.();
      if (proc?.pid) state.browserPid = proc.pid;
    } catch {}

    if (url) {
      await state.page.goto(url, { waitUntil: "load" });
      state.currentUrl = url;
    }

    state.weStartedOrca = startOrca();
    state.orcaActive = isOrcaRunning();
    if (!state.orcaActive) {
      await sleep(1000);
      state.orcaActive = isOrcaRunning();
    }
    if (!state.orcaActive) {
      throw new Error("Orca failed to start. Install: sudo apt install orca");
    }
    log("Orca active");

    try {
      safeWriteSync(ORCA_STATE_FILE, JSON.stringify({ weStartedOrca: state.weStartedOrca }));
    } catch {}

    await sleep(ORCA_INIT_SETTLE_MS);
    await focusBrowser();
    log("Browser focused, browse mode active");
  } catch (e) {
    log(`initialize failed, cleaning up: ${errorMsg(e)}`, true);
    try {
      await cleanup();
    } catch (cleanupErr) {
      log(`cleanup during failed init: ${errorMsg(cleanupErr)}`, true);
    }
    throw e;
  }
}

export async function navigate(url: string): Promise<VoResult> {
  return withLock(async () => {
    try {
      if (!state.page) return translateError("No page");
      await state.page.goto(url, { waitUntil: "load" });
      state.currentUrl = url;
      // Clear pre-existing speech (from any previous interaction) and take
      // the marker BEFORE focusBrowser — the click inside focusBrowser is
      // what triggers Orca's page/focus announcement, and we want to capture
      // it. marker = 0 (post-clear), the click's speech gets indices >= 0,
      // and readCurrentElement(marker) reads them all.
      speech.clear();
      const marker = speech.mark();
      await focusBrowser();
      return recordTranscript(await readCurrentElement(marker));
    } catch (e) {
      return translateError(e, { url });
    }
  });
}

// Memoized: cleanup can be reached concurrently — the SIGINT/SIGTERM
// handler in startServer registers BEFORE initialize(), so a signal during
// bootstrap runs cleanup() while initialize()'s own catch path is about to
// call it too. Both callers await the same single teardown.
let cleanupPromise: Promise<void> | null = null;

export function cleanup(): Promise<void> {
  if (!cleanupPromise) cleanupPromise = doCleanup();
  return cleanupPromise;
}

async function doCleanup(): Promise<void> {
  shuttingDown = true;
  await operationLock;
  speech.stopWatching();
  atspi.disconnect();
  try {
    if (state.browser) {
      await state.browser.close();
      state.browser = null;
    }
  } catch (e) {
    log(`browser close: ${errorMsg(e)}`, true);
  }
  if (state.orcaActive && state.weStartedOrca) stopOrca();
  state.orcaActive = false;
  state.page = null;
  state.currentUrl = null;
  // Reverse spawn order: registry daemons go down before the bus/display
  // they're attached to.
  for (const helper of [...ownedHelpers].reverse()) {
    try {
      process.kill(helper.pid);
      log(`Stopped ${helper.name} (PID: ${helper.pid})`);
    } catch {}
  }
  ownedHelpers = [];
  if (weStartedPulse) {
    try {
      execSync("pulseaudio --kill", { stdio: "pipe" });
      log("Stopped PulseAudio");
    } catch (e) {
      log(`pulseaudio --kill: ${errorMsg(e)}`, true);
    }
    weStartedPulse = false;
  }
}

export async function getItemText(): Promise<VoResult> {
  return withLock(async () => {
    try {
      return await readCurrentElement(speech.mark());
    } catch (e) {
      return translateError(e);
    }
  });
}

export async function orcaEnter(): Promise<VoResult> {
  return withLock(async () => {
    try {
      // Same shape as /navigate: clear + mark BEFORE focusBrowser so the
      // click's Orca announcement is captured with indices >= marker.
      speech.clear();
      const marker = speech.mark();
      await focusBrowser();
      return recordTranscript(await readCurrentElement(marker));
    } catch (e) {
      return translateError(e);
    }
  });
}
