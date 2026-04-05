#!/usr/bin/env bun

/**
 * VoiceOver Driver — interactive VoiceOver automation for accessibility testing.
 *
 * Two modes:
 *   Daemon:  bun vo-driver.mjs serve [--port 7483]
 *   CLI:     bun vo-driver.mjs <command> [args]
 *
 * The CLI spawns/connects to the daemon over HTTP on localhost.
 */

import { createServer } from "http";
import { spawn, spawnSync, execFile } from "child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { voiceOver } from "@guidepup/guidepup";
import { chromium } from "playwright";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = 7483;
const LOG_FILE = "/tmp/vo-driver.log";
const PID_FILE = "/tmp/vo-driver.pid";

// ---------------------------------------------------------------------------
// Command catalog
// ---------------------------------------------------------------------------

const COMMANDS = {
  // -- Element-type navigation --
  FIND_NEXT_HEADING:             { type: "keyboard", name: "findNextHeading" },
  FIND_PREVIOUS_HEADING:         { type: "keyboard", name: "findPreviousHeading" },
  FIND_NEXT_HEADING_SAME_LEVEL:  { type: "keyboard", name: "findNextHeadingOfSameLevel" },
  FIND_PREVIOUS_HEADING_SAME_LEVEL: { type: "keyboard", name: "findPreviousHeadingOfSameLevel" },
  FIND_NEXT_LINK:                { type: "keyboard", name: "findNextLink" },
  FIND_PREVIOUS_LINK:            { type: "keyboard", name: "findPreviousLink" },
  FIND_NEXT_VISITED_LINK:        { type: "keyboard", name: "findNextVisitedLink" },
  FIND_PREVIOUS_VISITED_LINK:    { type: "keyboard", name: "findPreviousVisitedLink" },
  FIND_NEXT_BUTTON:              { type: "commander", name: "FIND_NEXT_BUTTON" },
  FIND_PREVIOUS_BUTTON:          { type: "commander", name: "FIND_PREVIOUS_BUTTON" },
  FIND_NEXT_CONTROL:             { type: "keyboard", name: "findNextControl" },
  FIND_PREVIOUS_CONTROL:         { type: "keyboard", name: "findPreviousControl" },
  FIND_NEXT_TEXT_FIELD:           { type: "commander", name: "FIND_NEXT_TEXT_FIELD" },
  FIND_PREVIOUS_TEXT_FIELD:       { type: "commander", name: "FIND_PREVIOUS_FIELD" },
  FIND_NEXT_CHECKBOX:            { type: "commander", name: "FIND_NEXT_TICKBOX" },
  FIND_PREVIOUS_CHECKBOX:        { type: "commander", name: "FIND_PREVIOUS_TICKBOX" },
  FIND_NEXT_RADIO_GROUP:         { type: "commander", name: "FIND_NEXT_RADIO_GROUP" },
  FIND_PREVIOUS_RADIO_GROUP:     { type: "commander", name: "FIND_PREVIOUS_GROUP" },
  FIND_NEXT_TABLE:               { type: "keyboard", name: "findNextTable" },
  FIND_PREVIOUS_TABLE:           { type: "keyboard", name: "findPreviousTable" },
  FIND_NEXT_LIST:                { type: "keyboard", name: "findNextList" },
  FIND_PREVIOUS_LIST:            { type: "keyboard", name: "findPreviousList" },
  FIND_NEXT_LANDMARK:            { type: "commander", name: "FIND_NEXT_LANDMARK" },
  FIND_PREVIOUS_LANDMARK:        { type: "commander", name: "FIND_PREVIOUS_LANDMARK" },
  FIND_NEXT_IMAGE:               { type: "keyboard", name: "findNextGraphic" },
  FIND_PREVIOUS_IMAGE:           { type: "keyboard", name: "findPreviousGraphic" },
  FIND_NEXT_FRAME:               { type: "commander", name: "FIND_NEXT_FRAME" },
  FIND_PREVIOUS_FRAME:           { type: "commander", name: "FIND_PREVIOUS_FRAME" },
  FIND_NEXT_LIVE_REGION:         { type: "commander", name: "FIND_NEXT_LIVE_REGION" },

  // -- Position --
  GO_TO_BEGINNING:               { type: "commander", name: "GO_TO_BEGINNING" },
  GO_TO_END:                     { type: "commander", name: "GO_TO_END" },

  // -- Interaction --
  START_INTERACTING:             { type: "commander", name: "START_INTERACTING_WITH_ITEM" },
  STOP_INTERACTING:              { type: "commander", name: "STOP_INTERACTING_WITH_ITEM" },
  ACTIVATE:                      { type: "keyboard", name: "performDefaultActionForItem" },
  ESCAPE:                        { type: "commander", name: "ESCAPE" },

  // -- Rotor --
  OPEN_ROTOR:                    { type: "commander", name: "ROTOR" },
  OPEN_WEB_ROTOR:                { type: "keyboard", name: "openWebItemRotor" },
  ROTOR_UP:                      { type: "commander", name: "MOVE_UP_IN_ROTOR" },
  ROTOR_DOWN:                    { type: "commander", name: "MOVE_DOWN_IN_ROTOR" },
  ROTATE_LEFT:                   { type: "commander", name: "ROTATE_LEFT" },
  ROTATE_RIGHT:                  { type: "commander", name: "ROTATE_RIGHT" },

  // -- Reading --
  READ_CURRENT_ITEM:             { type: "commander", name: "READ_CONTENTS_OF_VOICEOVER_CURSOR" },
  READ_ALL:                      { type: "keyboard", name: "readAllText" },
  READ_LINE:                     { type: "keyboard", name: "readLine" },
  READ_WORD:                     { type: "keyboard", name: "readWord" },
  READ_FROM_TOP:                 { type: "keyboard", name: "readFromBeginningToCurrent" },
  READ_LINK_URL:                 { type: "keyboard", name: "readLinkAddress" },
  READ_PAGE_STATS:               { type: "keyboard", name: "readWebpageStatistics" },

  // -- Table reading --
  READ_TABLE_ROW:                { type: "keyboard", name: "readTableRow" },
  READ_TABLE_COLUMN:             { type: "keyboard", name: "readTableColumn" },
  READ_TABLE_HEADER:             { type: "keyboard", name: "readTableColumnHeader" },
  READ_TABLE_POSITION:           { type: "keyboard", name: "readTableRowAndColumnNumbers" },

  // -- Focus --
  SYNC_CURSOR_TO_KEYBOARD:       { type: "keyboard", name: "moveCursorToKeyboardFocus" },
  SYNC_KEYBOARD_TO_CURSOR:       { type: "keyboard", name: "moveKeyboardFocusToCursor" },
  DESCRIBE_KEYBOARD_FOCUS:       { type: "keyboard", name: "describeItemWithKeyboardFocus" },

  // -- Navigation modes --
  TOGGLE_DOM_GROUP_NAV:          { type: "commander", name: "TOGGLE_WEB_NAVIGATION_DOM_OR_GROUP" },
  TOGGLE_QUICK_NAV:              { type: "commander", name: "TOGGLE_QUICK_NAV_ON_OR_OFF" },
  TOGGLE_SINGLE_KEY_NAV:         { type: "commander", name: "TOGGLE_SINGLE_KEY_QUICK_NAV_ON_OR_OFF" },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = {
  voiceoverActive: false,
  currentUrl: null,
  browser: null,
  page: null,
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg, err = false) {
  const line = `[${new Date().toISOString()}] [${err ? "ERROR" : "INFO"}] ${msg}\n`;
  try { writeFileSync(LOG_FILE, line, { flag: "a" }); } catch {}
}

// ---------------------------------------------------------------------------
// AppleScript helpers (used only for `press`, `snapshot`, and focus management)
// ---------------------------------------------------------------------------

function runAppleScript(script, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const proc = spawn("osascript", ["-e", script]);
    let out = "", err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error("AppleScript timeout")); }, timeout);
    proc.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`));
    });
  });
}

async function getSpokenPhraseRaw() {
  try {
    return await runAppleScript('tell application "VoiceOver" to get content of last phrase', 5000);
  } catch { return ""; }
}

// ---------------------------------------------------------------------------
// VoiceOver operations (via guidepup — no Promise.race, let guidepup handle timeouts)
// ---------------------------------------------------------------------------

async function voNext() {
  await voiceOver.next();
  const spoken = await voiceOver.lastSpokenPhrase();
  const itemText = await voiceOver.itemText();
  return { success: true, spoken, itemText };
}

async function voPrevious() {
  await voiceOver.previous();
  const spoken = await voiceOver.lastSpokenPhrase();
  const itemText = await voiceOver.itemText();
  return { success: true, spoken, itemText };
}

async function voAct() {
  await voiceOver.act();
  const spoken = await voiceOver.lastSpokenPhrase();
  const itemText = await voiceOver.itemText();
  return { success: true, spoken, itemText };
}

async function voPerform(commandName) {
  const entry = COMMANDS[commandName];

  let commandObj;
  if (entry) {
    const source = entry.type === "commander"
      ? voiceOver.commanderCommands
      : voiceOver.keyboardCommands;
    commandObj = source[entry.name];
    if (!commandObj) return { success: false, error: `${entry.type} command "${entry.name}" not found in guidepup` };
  } else {
    // Try as raw commander command name
    commandObj = voiceOver.commanderCommands[commandName];
    if (!commandObj) return { success: false, error: `Unknown command: ${commandName}` };
  }

  await voiceOver.perform(commandObj);
  const spoken = await voiceOver.lastSpokenPhrase();
  const itemText = await voiceOver.itemText();
  return { success: true, spoken, itemText };
}

// ---------------------------------------------------------------------------
// Press — raw keystrokes via AppleScript (for Tab, arrows in rotor, etc.)
// ---------------------------------------------------------------------------

const KEY_CODES = {
  Return: 36, Enter: 36, Space: 49, Escape: 53, Tab: 48,
  Left: 123, Right: 124, Down: 125, Up: 126,
  Delete: 51, Backspace: 51, Home: 115, End: 119,
  PageUp: 116, PageDown: 121,
};

const MOD_MAP = {
  control: "control down", option: "option down",
  command: "command down", shift: "shift down",
};

async function voPress(key, modifiers = []) {
  const modStr = modifiers.map((m) => MOD_MAP[m]).filter(Boolean).join(", ");
  const usingClause = modStr ? ` using {${modStr}}` : "";
  const code = KEY_CODES[key];

  const script = code !== undefined
    ? `tell application "System Events" to key code ${code}${usingClause}`
    : `tell application "System Events" to keystroke "${key}"${usingClause}`;

  await runAppleScript(script);
  await new Promise((r) => setTimeout(r, 600));
  const spoken = await getSpokenPhraseRaw();
  return { success: true, spoken, itemText: spoken };
}

// ---------------------------------------------------------------------------
// Snapshot — raw AppleScript walk (skips guidepup capture for speed)
// ---------------------------------------------------------------------------

async function voSnapshot(steps = 30) {
  const results = [];
  let lastPhrase = "", repeatCount = 0;

  for (let i = 0; i < steps; i++) {
    try {
      await runAppleScript('tell application "VoiceOver" to tell vo cursor to move right');
    } catch { break; }
    await new Promise((r) => setTimeout(r, 500));

    const spoken = await getSpokenPhraseRaw();
    results.push({ step: i + 1, spoken, itemText: spoken });

    if (spoken === lastPhrase) { if (++repeatCount >= 3) break; }
    else { repeatCount = 0; lastPhrase = spoken; }
  }
  return { success: true, steps: results.length, results };
}

// ---------------------------------------------------------------------------
// Browser + VoiceOver lifecycle
// ---------------------------------------------------------------------------

async function initialize(url) {
  state.browser = await chromium.launch({ headless: false });
  const ctx = await state.browser.newContext();
  state.page = await ctx.newPage();

  if (url) {
    await state.page.goto(url, { waitUntil: "load" });
    state.currentUrl = url;
  }

  await voiceOver.start();
  state.voiceoverActive = true;
  log("VoiceOver started");

  // Max out speech rate so phrase capture is fast
  try {
    spawnSync("defaults", ["write",
      "com.apple.VoiceOver4/default",
      "SCRCategories_SCRCategorySystemWide_SCRSpeechLanguages_default_SCRSpeechComponentSettings_SCRRateAsPercent",
      "-int", "100"]);
    log("Speech rate set to 100");
  } catch (e) { log(`speech rate warning: ${e.message}`); }

  // Bring browser to foreground
  await new Promise((r) => setTimeout(r, 1500));
  try {
    spawnSync("osascript", ["-e", 'tell application "Google Chrome for Testing" to activate']);
    await new Promise((r) => setTimeout(r, 500));
    await state.page.bringToFront();
    await new Promise((r) => setTimeout(r, 500));
    await state.page.click("body", { force: true });
    await new Promise((r) => setTimeout(r, 300));
    log("Browser focused");
  } catch (e) { log(`focus warning: ${e.message}`); }
}

async function navigate(url) {
  if (!state.page) return { success: false, error: "No page" };
  await state.page.goto(url, { waitUntil: "load" });
  state.currentUrl = url;

  try {
    spawnSync("osascript", ["-e", 'tell application "Google Chrome for Testing" to activate']);
    await new Promise((r) => setTimeout(r, 500));
    await state.page.bringToFront();
    await new Promise((r) => setTimeout(r, 300));
    await state.page.click("body", { force: true });
    await new Promise((r) => setTimeout(r, 300));
  } catch (e) { log(`navigate focus: ${e.message}`); }

  return { success: true, url };
}

async function cleanup() {
  try { if (state.browser) { await state.browser.close(); state.browser = null; } } catch {}
  try {
    if (state.voiceoverActive) { await voiceOver.stop(); state.voiceoverActive = false; }
  } catch {
    try { spawnSync("osascript", ["-e", 'tell application "VoiceOver" to quit']); } catch {}
    state.voiceoverActive = false;
  }
  state.page = null;
  state.currentUrl = null;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

async function handle(req, res) {
  const { method } = req;
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  try {
    if (path === "/" && method === "GET")
      return json(res, 200, { status: "running", voiceoverActive: state.voiceoverActive, currentUrl: state.currentUrl });

    if (path === "/next" && method === "POST")
      return json(res, 200, await voNext());

    if (path === "/previous" && method === "POST")
      return json(res, 200, await voPrevious());

    if (path === "/act" && method === "POST")
      return json(res, 200, await voAct());

    if (path === "/perform" && method === "POST") {
      const { command } = JSON.parse(await readBody(req));
      return json(res, 200, await voPerform(command));
    }

    if (path === "/press" && method === "POST") {
      const { key, modifiers } = JSON.parse(await readBody(req));
      return json(res, 200, await voPress(key, modifiers));
    }

    if (path === "/navigate" && method === "POST") {
      const { url: navUrl } = JSON.parse(await readBody(req));
      return json(res, 200, await navigate(navUrl));
    }

    if (path === "/snapshot" && method === "POST") {
      const { steps } = JSON.parse(await readBody(req) || "{}");
      return json(res, 200, await voSnapshot(steps));
    }

    if (path === "/last-phrase" && method === "GET") {
      const spoken = await voiceOver.lastSpokenPhrase();
      return json(res, 200, { spoken });
    }

    if (path === "/item-text" && method === "GET") {
      const itemText = await voiceOver.itemText();
      return json(res, 200, { itemText });
    }

    if (path === "/phrase-log" && method === "GET") {
      const phraseLog = await voiceOver.spokenPhraseLog();
      return json(res, 200, { phraseLog });
    }

    if (path === "/commands" && method === "GET") {
      const filter = url.searchParams.get("filter") || "";
      let cmds = Object.keys(COMMANDS);
      if (filter) cmds = cmds.filter((c) => c.toLowerCase().includes(filter.toLowerCase()));
      return json(res, 200, { commands: cmds });
    }

    if (path === "/stop" && method === "POST") {
      json(res, 200, { success: true });
      setImmediate(async () => {
        await cleanup();
        try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch {}
        process.exit(0);
      });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    log(`HTTP error: ${e.message}`, true);
    json(res, 500, { error: e.message });
  }
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

async function startServer(port, url) {
  await initialize(url);

  const server = createServer(handle);
  server.listen(port, "127.0.0.1", () => {
    log(`Server on http://127.0.0.1:${port}`);
    console.log(`Server ready on http://127.0.0.1:${port}`);
    try { writeFileSync(PID_FILE, process.pid.toString()); } catch {}
  });

  const shutdown = async () => {
    server.close();
    const timer = setTimeout(() => process.exit(1), 5000);
    await cleanup();
    clearTimeout(timer);
    try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ---------------------------------------------------------------------------
// CLI client
// ---------------------------------------------------------------------------

async function cli(args, port) {
  const [cmd, ...rest] = args;
  const base = `http://127.0.0.1:${port}`;

  // Helpers
  const post = async (path, body) => {
    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json();
    if (!r.ok) { console.error(`Error: ${d.error}`); process.exit(1); }
    return d;
  };

  const get = async (path) => {
    const r = await fetch(`${base}${path}`);
    return r.json();
  };

  const printVO = (d) => {
    if (d.spoken) console.log(`Spoken: "${d.spoken}"`);
    if (d.itemText) console.log(`Item: "${d.itemText}"`);
  };

  switch (cmd) {
    case "start": {
      const url = rest[0] || "about:blank";
      console.log(`Starting server and navigating to ${url}...`);

      // Already running?
      try {
        const r = await fetch(`${base}/`);
        if (r.ok) {
          console.log("Server already running.");
          if (url !== "about:blank") await post("/navigate", { url });
          console.log("Ready");
          return;
        }
      } catch {}

      // Clean stale PID
      if (existsSync(PID_FILE)) { try { unlinkSync(PID_FILE); } catch {} }

      // Spawn daemon
      const child = spawn(process.argv[0], [process.argv[1], "serve", "--port", port.toString()], {
        detached: true, stdio: "ignore",
      });
      child.unref();

      // Poll until ready
      for (let i = 0; i < 200; i++) {
        try { const r = await fetch(`${base}/`); if (r.ok) break; } catch {}
        if (i === 199) { console.error("Server failed to start"); process.exit(1); }
        await new Promise((r) => setTimeout(r, 200));
      }

      if (url !== "about:blank") await post("/navigate", { url });
      console.log("Server started and ready");
      break;
    }

    case "next":     printVO(await post("/next")); break;
    case "previous": printVO(await post("/previous")); break;
    case "act":      printVO(await post("/act")); break;

    case "press": {
      if (!rest[0]) { console.error("press requires a key name"); process.exit(1); }
      const d = await post("/press", { key: rest[0], modifiers: rest.slice(1).flatMap((m) => m.split(",")).filter(Boolean) });
      if (d.spoken) console.log(`Spoken: "${d.spoken}"`);
      break;
    }

    case "perform": {
      if (!rest[0]) { console.error("perform requires a command name"); process.exit(1); }
      const d = await post("/perform", { command: rest[0] });
      console.log(`Performed: ${rest[0]}`);
      printVO(d);
      break;
    }

    case "navigate": {
      if (!rest[0]) { console.error("navigate requires a URL"); process.exit(1); }
      await post("/navigate", { url: rest[0] });
      console.log(`Navigated to ${rest[0]}`);
      break;
    }

    case "snapshot": {
      const steps = rest[0] === "--steps" ? parseInt(rest[1]) || 30 : 30;
      console.log(`Snapshot: ${steps} steps...`);
      const d = await post("/snapshot", { steps });
      d.results.forEach((r) => console.log(`[${r.step}] "${r.spoken}"`));
      break;
    }

    case "last-phrase":  console.log((await get("/last-phrase")).spoken); break;
    case "item-text":    console.log((await get("/item-text")).itemText); break;
    case "phrase-log":   (await get("/phrase-log")).phraseLog.forEach((p, i) => console.log(`[${i + 1}] ${p}`)); break;
    case "commands": {
      const f = rest[0] || "";
      (await get(`/commands?filter=${encodeURIComponent(f)}`)).commands.forEach((c) => console.log(c));
      break;
    }

    case "status": {
      const d = await get("/");
      console.log(`Status: ${d.status}\nVoiceOver: ${d.voiceoverActive}\nURL: ${d.currentUrl || "(none)"}`);
      break;
    }

    case "stop": {
      try { await fetch(`${base}/stop`, { method: "POST" }); console.log("Stopped"); return; } catch {}
      if (existsSync(PID_FILE)) {
        const pid = parseInt(readFileSync(PID_FILE, "utf-8"));
        process.kill(pid, "SIGTERM");
        console.log(`Sent SIGTERM to ${pid}`);
      } else { console.error("No running server"); process.exit(1); }
      break;
    }

    case "kill": {
      if (!existsSync(PID_FILE)) { console.error("No PID file"); process.exit(1); }
      const pid = parseInt(readFileSync(PID_FILE, "utf-8"));
      process.kill(pid, "SIGKILL");
      unlinkSync(PID_FILE);
      spawnSync("osascript", ["-e", 'tell application "VoiceOver" to quit']);
      console.log("Killed");
      break;
    }

    default:
      console.error(`Unknown: ${cmd}\nCommands: start next previous act press perform navigate snapshot status stop kill last-phrase item-text phrase-log commands`);
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let port = PORT;
const pi = args.indexOf("--port");
if (pi !== -1) port = parseInt(args[pi + 1]) || PORT;

if (args[0] === "serve") {
  const rest = args.slice(1).filter((a, i, arr) => !a.startsWith("--") && !(i > 0 && arr[i - 1]?.startsWith("--")));
  startServer(port, rest[0] || null).catch((e) => { console.error(e.message); process.exit(1); });
} else {
  cli(args, port).catch((e) => { console.error(e.message); process.exit(1); });
}
