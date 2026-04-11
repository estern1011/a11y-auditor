/**
 * Core Orca screen reader operations, state, and browser lifecycle for Linux.
 *
 * This is the Linux counterpart to vo-core.ts. It uses:
 * - Orca screen reader (GNOME's built-in AT)
 * - Speech capture via speech-dispatcher sd_generic module (orca-speech.ts)
 * - AT-SPI2 via D-Bus for accessibility tree queries (orca-atspi.ts)
 * - xdotool for keyboard simulation
 * - Playwright for browser management (same as VoiceOver driver)
 *
 * Other modules (server, CLI) import from here — never from AT-SPI2 directly.
 */

import { spawn, spawnSync, execSync } from "child_process";
import { writeFileSync, existsSync, unlinkSync } from "fs";
import { chromium } from "playwright";
import type { Page, Browser } from "playwright";
import { translateError, type ErrorContext } from "./orca-errors.ts";
import {
  type VoResponse, type VoError, type VoResult, type TranscriptEntry,
  isVoError, ORCA_COMMANDS,
} from "./orca-types.ts";
import * as speech from "./orca-speech.ts";
import * as atspi from "./orca-atspi.ts";

// Re-export orca-types surface so consumers can import from orca-core alone
export type { VoResponse, VoError, VoResult, TranscriptEntry } from "./vo-types.ts";
export { isVoError, ORCA_COMMANDS } from "./orca-types.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const DEFAULT_PORT = 7484;       // different from vo-driver to allow co-existence
export const DEFAULT_CDP_PORT = 9223;   // different from vo-driver
export const LOG_FILE = "/tmp/orca-driver.log";
export const PID_FILE = "/tmp/orca-driver.pid";
export const ORCA_STATE_FILE = "/tmp/orca-driver-state.json";

export const CLI_TIMEOUT_MS = 30_000;
export const STARTUP_POLL_MS = 200;
export const STARTUP_POLL_MAX = 200;
export const MAX_TRANSCRIPT_ENTRIES = 10_000;
export const MAX_REQUEST_BODY = 1_000_000;

// Delays for Orca to settle after actions (ms)
const ORCA_SETTLE_MS = 1000;
const ORCA_QUICK_SETTLE_MS = 400;
const ORCA_PRESS_SETTLE_MS = 1000;
const ORCA_INIT_SETTLE_MS = 3000;

// Tracks child processes we started (for cleanup)
let xvfbProc: ReturnType<typeof spawn> | null = null;
let atSpiProc: ReturnType<typeof spawn> | null = null;
let atSpiRegistryProc: ReturnType<typeof spawn> | null = null;

// ---------------------------------------------------------------------------
// Operation lock — serializes all Orca operations
// ---------------------------------------------------------------------------

let operationLock: Promise<void> = Promise.resolve();
let shuttingDown = false;

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (shuttingDown) return Promise.reject(new Error("Driver is shutting down"));
  const prev = operationLock;
  const { promise, resolve } = Promise.withResolvers<void>();
  operationLock = promise;
  return prev.then(fn).finally(resolve);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function errorMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function removePidFile() {
  try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch {}
  try { if (existsSync(ORCA_STATE_FILE)) unlinkSync(ORCA_STATE_FILE); } catch {}
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

// --- State accessors ---

export function getPage(): Page | null { return state.page; }
export function getStatus(): { orcaActive: boolean; currentUrl: string | null; cdpPort: number } {
  return { orcaActive: state.orcaActive, currentUrl: state.currentUrl, cdpPort: state.cdpPort };
}
export function getTranscriptLength(): number { return state.transcript.length; }

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export function log(msg: string, err = false) {
  const line = `[${new Date().toISOString()}] [${err ? "ERROR" : "INFO"}] ${msg}\n`;
  try { writeFileSync(LOG_FILE, line, { flag: "a" }); } catch {}
}

function recordTranscript(entry: VoResponse): TranscriptEntry {
  const indexed: TranscriptEntry = { ...entry, index: state.transcriptIndex++ };
  state.transcript.push(indexed);
  if (state.transcript.length > MAX_TRANSCRIPT_ENTRIES) {
    state.transcript = state.transcript.slice(-MAX_TRANSCRIPT_ENTRIES);
  }
  return indexed;
}

// ---------------------------------------------------------------------------
// Transcript access
// ---------------------------------------------------------------------------

export function getTranscript(since?: number): TranscriptEntry[] {
  if (since !== undefined) {
    return state.transcript.filter((e) => e.index > since);
  }
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

/**
 * After a keystroke, capture what Orca said and what AT-SPI2 reports
 * as the focused element. Returns a VoResponse combining both.
 */
async function readCurrentElement(speechMarker: number): Promise<VoResponse> {
  // Flush speech buffer to get any new entries
  speech.flush();
  const spoken = speech.spokenSince(speechMarker);

  // Get structured element info from AT-SPI2
  let name = "", role = "", elementState: string[] = [];
  try {
    const element = await atspi.getItemInfo();
    if (element) {
      name = element.name;
      role = element.role;
      elementState = element.state.filter(s =>
        // Only include interesting states
        ["focused", "checked", "expanded", "collapsed", "selected",
         "required", "visited", "pressed", "has-popup"].includes(s)
      );
    }
  } catch (e) {
    log(`AT-SPI2 query: ${errorMsg(e)}`, true);
  }

  // If speech capture is empty, use AT-SPI2 name as fallback
  const spokenText = spoken || [name, role].filter(Boolean).join(", ");

  return { spoken: spokenText, name, role, state: elementState };
}

function detectKeyTool(): "xdotool" | "ydotool" | null {
  try { execSync("which xdotool", { stdio: "pipe" }); return "xdotool"; } catch {}
  try { execSync("which ydotool", { stdio: "pipe" }); return "ydotool"; } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// Keyboard simulation via AT-SPI2 D-Bus
//
// We inject keys through AT-SPI2's DeviceEventController, NOT through
// xdotool/XTEST. This is critical because Orca registers its keyboard
// listener via AT-SPI2 D-Bus — XTEST events bypass that pipeline entirely,
// so Orca never sees xdotool keystrokes.
// ---------------------------------------------------------------------------

async function sendKey(key: string, modifiers: string[] = []) {
  await atspi.generateKeyboardEvent(key, modifiers);
}

// xdotool key name mapping
const KEY_MAP: Record<string, string> = {
  Return: "Return", Enter: "Return",
  Space: "space", Escape: "Escape", Tab: "Tab",
  Left: "Left", Right: "Right", Down: "Down", Up: "Up",
  Delete: "Delete", Backspace: "BackSpace",
  Home: "Home", End: "End",
  PageUp: "Prior", PageDown: "Next",
  F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6",
  F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12",
};

const MODIFIER_MAP: Record<string, string> = {
  control: "ctrl", ctrl: "ctrl",
  shift: "shift", alt: "alt",
  option: "alt",    // macOS compat
  super: "super", meta: "super",
  command: "super", // macOS compat
};

export const VALID_MODIFIERS: Record<string, string> = {
  control: "ctrl", ctrl: "ctrl",
  shift: "shift", alt: "alt", super: "super",
};

function resolveKey(key: string): string {
  return KEY_MAP[key] || key;
}

function resolveModifiers(mods: string[]): string[] {
  return mods.map((m) => {
    const resolved = MODIFIER_MAP[m.toLowerCase()];
    if (!resolved) throw new Error(`Unknown modifier: ${m}. Valid: ${Object.keys(VALID_MODIFIERS).join(", ")}`);
    return resolved;
  });
}

// ---------------------------------------------------------------------------
// Headless environment bootstrap
// ---------------------------------------------------------------------------

function ensureDisplay(): void {
  if (process.env.DISPLAY) {
    log(`Using existing display: ${process.env.DISPLAY}`);
    return;
  }

  try { execSync("which Xvfb", { stdio: "pipe" }); } catch {
    throw new Error("No DISPLAY set and Xvfb not found. Run: sudo bash orca-setup.sh");
  }

  // Check if Xvfb is already running on :99
  try {
    execSync("xdotool getdisplaygeometry", { stdio: "pipe", timeout: 3000, env: { ...process.env, DISPLAY: ":99" } });
    process.env.DISPLAY = ":99";
    log("Using existing Xvfb on :99");
    return;
  } catch {}

  // Start Xvfb on :99
  try { execSync("rm -f /tmp/.X99-lock", { stdio: "pipe" }); } catch {}

  log("Starting Xvfb on :99...");
  xvfbProc = spawn("Xvfb", [":99", "-screen", "0", "1280x1024x24", "-ac"], {
    stdio: "pipe", detached: true,
  });
  xvfbProc.unref();

  const start = Date.now();
  let displayReady = false;
  while (Date.now() - start < 3000) {
    try {
      execSync("xdotool getdisplaygeometry", {
        stdio: "pipe", timeout: 1000,
        env: { ...process.env, DISPLAY: ":99" },
      });
      displayReady = true;
      break;
    } catch {
      spawnSync("sleep", ["0.3"]);
    }
  }

  if (!displayReady) throw new Error("Xvfb failed to start on :99");
  process.env.DISPLAY = ":99";
  log(`Xvfb started on :99 (PID: ${xvfbProc.pid})`);
}

function ensureWindowManager(): void {
  try {
    if (spawnSync("pgrep", ["-x", "openbox"], { stdio: "pipe" }).status === 0) {
      log("Window manager (openbox) already running");
      return;
    }
  } catch {}

  try { execSync("which openbox", { stdio: "pipe" }); } catch {
    log("openbox not found — window focus may not work", true);
    return;
  }

  const wm = spawn("openbox", [], { stdio: "ignore", detached: true, env: process.env });
  wm.unref();
  spawnSync("sleep", ["0.5"]);
  log("Started openbox window manager");
}

function ensureDbus(): void {
  if (process.env.DBUS_SESSION_BUS_ADDRESS) {
    log(`Using existing D-Bus: ${process.env.DBUS_SESSION_BUS_ADDRESS}`);
    return;
  }

  try {
    const result = execSync("dbus-launch --sh-syntax", { encoding: "utf-8" });
    const match = result.match(/DBUS_SESSION_BUS_ADDRESS='([^']+)'/);
    if (match) {
      process.env.DBUS_SESSION_BUS_ADDRESS = match[1];
      log(`D-Bus started: ${match[1]}`);
    } else {
      throw new Error("dbus-launch output not parseable");
    }
  } catch (e) {
    throw new Error(`Failed to start D-Bus: ${errorMsg(e)}. Run: sudo apt install dbus-x11`);
  }
}

function ensureAtSpi2(): void {
  try {
    const launcherPath = spawnSync("which", ["/usr/libexec/at-spi-bus-launcher"], { stdio: "pipe" }).status === 0
      ? "/usr/libexec/at-spi-bus-launcher"
      : "/usr/lib/at-spi2-core/at-spi-bus-launcher";
    atSpiProc = spawn(launcherPath, [], { stdio: "ignore", detached: true, env: process.env });
    atSpiProc.unref();
    log("AT-SPI2 bus launcher started");
  } catch (e) {
    log(`AT-SPI2 bus launcher: ${errorMsg(e)} (may already be running)`);
  }

  try {
    const registrydPath = spawnSync("which", ["/usr/libexec/at-spi2-registryd"], { stdio: "pipe" }).status === 0
      ? "/usr/libexec/at-spi2-registryd"
      : "/usr/lib/at-spi2-core/at-spi2-registryd";
    atSpiRegistryProc = spawn(registrydPath, [], { stdio: "ignore", detached: true, env: process.env });
    atSpiRegistryProc.unref();
    log("AT-SPI2 registryd started");
  } catch (e) {
    log(`AT-SPI2 registryd: ${errorMsg(e)} (may already be running)`);
  }
}

function ensureAudioSink(): void {
  try { execSync("which pulseaudio", { stdio: "pipe" }); } catch {
    process.env.PULSE_SERVER = "none";
    log("No PulseAudio, set PULSE_SERVER=none");
    return;
  }

  try {
    execSync("pulseaudio --check 2>/dev/null || pulseaudio --start --exit-idle-time=-1", { stdio: "pipe" });
    execSync("pactl load-module module-null-sink sink_name=dummy 2>/dev/null || true", { stdio: "pipe" });
    log("PulseAudio started with null sink");
  } catch (e) {
    process.env.PULSE_SERVER = "none";
    log(`PulseAudio setup failed (${errorMsg(e)}), set PULSE_SERVER=none`);
  }
}

function ensureHeadlessEnv(): void {
  if (process.env.NO_AT_BRIDGE) {
    delete process.env.NO_AT_BRIDGE;
    log("Unset NO_AT_BRIDGE (was blocking AT-SPI2 bridge)");
  }

  if (!process.env.GTK_MODULES?.includes("atk-bridge")) {
    process.env.GTK_MODULES = process.env.GTK_MODULES
      ? `${process.env.GTK_MODULES}:gail:atk-bridge`
      : "gail:atk-bridge";
    log("Set GTK_MODULES=gail:atk-bridge (required for AT-SPI2 bridge)");
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
  try { return spawnSync("pgrep", ["-x", "orca"]).status === 0; } catch { return false; }
}

function startOrca(): boolean {
  if (isOrcaRunning()) {
    log("Orca already running");
    return false;
  }
  const child = spawn("orca", [], {
    detached: true, stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
  log("Started Orca");
  return true;
}

function stopOrca() {
  try { spawnSync("pkill", ["-x", "orca"]); log("Stopped Orca"); }
  catch (e) { log(`Failed to stop Orca: ${errorMsg(e)}`, true); }
}

// ---------------------------------------------------------------------------
// Orca operations — send keys, capture speech, read AT-SPI2
// ---------------------------------------------------------------------------

async function orcaAction(keyName: string, modifiers: string[] = []): Promise<TranscriptEntry> {
  const marker = speech.mark();
  await sendKey(resolveKey(keyName), resolveModifiers(modifiers));
  await sleep(ORCA_SETTLE_MS);
  const element = await readCurrentElement(marker);
  return recordTranscript(element);
}

function lockedOrcaAction(keyName: string, modifiers: string[] = []): Promise<VoResult> {
  return withLock(async () => {
    try { return await orcaAction(keyName, modifiers); }
    catch (e) { return translateError(e); }
  });
}

export function orcaNext(): Promise<VoResult> { return lockedOrcaAction("Down"); }
export function orcaPrevious(): Promise<VoResult> { return lockedOrcaAction("Up"); }
export function orcaAct(): Promise<VoResult> { return lockedOrcaAction("Return"); }

export async function orcaPerform(commandName: string): Promise<VoResult> {
  return withLock(async () => {
    const entry = ORCA_COMMANDS[commandName];
    const ctx: ErrorContext = { command: commandName };

    if (!entry) return translateError(`Unknown command: ${commandName}`, ctx);

    try {
      const marker = speech.mark();
      await sendKey(resolveKey(entry.key), resolveModifiers(entry.modifiers || []));
      await sleep(entry.settle || ORCA_SETTLE_MS);
      const element = await readCurrentElement(marker);
      return recordTranscript(element);
    } catch (e) {
      return translateError(e, ctx);
    }
  });
}

export async function orcaPress(key: string, modifiers: string[] = []): Promise<VoResult> {
  return withLock(async () => {
    const unknown = modifiers.filter((m) => !MODIFIER_MAP[m.toLowerCase()]);
    if (unknown.length > 0) {
      return translateError(`Unknown modifier(s): ${unknown.join(", ")}`, { key });
    }

    try {
      const marker = speech.mark();
      await sendKey(resolveKey(key), resolveModifiers(modifiers));
      await sleep(ORCA_PRESS_SETTLE_MS);
      const element = await readCurrentElement(marker);
      return recordTranscript(element);
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
    const result = spawnSync("xdotool", searchArgs, { encoding: "utf-8", timeout: 5000, env: process.env });
    const windowId = (result.stdout || "").trim().split("\n")[0];
    log(`xdotool search: args=${JSON.stringify(searchArgs)} windowId=${windowId} stderr=${result.stderr?.trim()}`);
    if (windowId) {
      spawnSync("xdotool", ["windowfocus", "--sync", windowId], { timeout: 5000, env: process.env });
      await sleep(ORCA_QUICK_SETTLE_MS);
    }

    // Click in the center of the screen (the Chrome window should be maximized).
    // xdotool click at screen coordinates triggers a real X11 click that Chrome
    // processes as a focus event, causing Orca to detect the web document and
    // enter browse mode. Screen is 1280x1024, click at center-bottom content area.
    spawnSync("xdotool", ["mousemove", "640", "600", "click", "1"], { timeout: 5000, env: process.env });
    await sleep(ORCA_SETTLE_MS);

    // Clear the speech buffer so startup noise doesn't leak into navigation
    speech.clear();
  } catch (e) { log(`focus warning: ${errorMsg(e)}`); }
}

export async function initialize(url: string | null, cdpPort: number) {
  state.cdpPort = cdpPort;

  // Bootstrap headless environment
  ensureHeadlessEnv();

  // Configure speech capture BEFORE Orca starts
  // (Orca auto-starts speech-dispatcher which will pick up our config)
  speech.ensureSpeechCapture(log);

  // AT-SPI2 bus starts asynchronously — give it time
  await sleep(1000);

  // xdotool is still used for window focus management (focusBrowser)
  if (!detectKeyTool()) {
    log("xdotool not found — window focusing may not work. Install: sudo apt install xdotool", true);
  }

  state.browser = await chromium.launch({
    headless: false,
    args: [
      `--remote-debugging-port=${cdpPort}`,
      "--force-renderer-accessibility",
      "--start-maximized",
    ],
  });
  // Use viewport: null to respect the window size (maximized)
  const ctx = await state.browser.newContext({ viewport: null });
  state.page = await ctx.newPage();

  try {
    const proc = (state.browser as any)?.process?.();
    if (proc?.pid) state.browserPid = proc.pid;
  } catch {}

  if (url) {
    await state.page.goto(url, { waitUntil: "load" });
    state.currentUrl = url;
  }

  // Start Orca (after speech-dispatcher config is in place)
  state.weStartedOrca = startOrca();
  state.orcaActive = isOrcaRunning();

  if (!state.orcaActive) {
    await sleep(1000);
    state.orcaActive = isOrcaRunning();
  }

  if (!state.orcaActive) {
    try { await state.browser.close(); } catch {}
    state.browser = null;
    state.page = null;
    throw new Error("Orca failed to start. Ensure orca is installed: sudo apt install orca");
  }

  log("Orca active");

  try {
    writeFileSync(ORCA_STATE_FILE, JSON.stringify({ weStartedOrca: state.weStartedOrca }));
  } catch {}

  // Wait for Orca to fully initialize and process the page load.
  // Orca auto-enters browse mode when it detects a web document has focus.
  await sleep(5000);
  await focusBrowser();
  await sleep(ORCA_SETTLE_MS);
  log("Browser focused");
}

export async function navigate(url: string): Promise<VoResult> {
  return withLock(async () => {
    try {
      if (!state.page) return translateError("No page");
      const marker = speech.mark();
      await state.page.goto(url, { waitUntil: "load" });
      state.currentUrl = url;
      await focusBrowser();
      await sleep(ORCA_SETTLE_MS);
      const element = await readCurrentElement(marker);
      return recordTranscript(element);
    } catch (e) {
      return translateError(e, { url });
    }
  });
}

export async function cleanup() {
  shuttingDown = true;
  await operationLock;

  // Stop speech capture
  speech.stopWatching();

  // Disconnect AT-SPI2 D-Bus
  atspi.disconnect();

  try {
    if (state.browser) { await state.browser.close(); state.browser = null; }
  } catch (e) { log(`browser close: ${errorMsg(e)}`, true); }

  if (state.orcaActive && state.weStartedOrca) stopOrca();
  state.orcaActive = false;
  state.page = null;
  state.currentUrl = null;

  for (const proc of [atSpiRegistryProc, atSpiProc, xvfbProc]) {
    if (proc?.pid) { try { process.kill(proc.pid); } catch {} }
  }
  atSpiRegistryProc = null;
  atSpiProc = null;
  xvfbProc = null;
}

export async function getItemText(): Promise<VoResult> {
  return withLock(async () => {
    try {
      const marker = speech.mark();
      const element = await readCurrentElement(marker);
      return element;
    } catch (e) {
      return translateError(e);
    }
  });
}

export async function orcaEnter(): Promise<VoResult> {
  return withLock(async () => {
    try {
      const marker = speech.mark();
      await focusBrowser();
      await sleep(ORCA_SETTLE_MS);
      const element = await readCurrentElement(marker);
      return recordTranscript(element);
    } catch (e) {
      return translateError(e);
    }
  });
}
