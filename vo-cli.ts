/**
 * CLI client for the VoiceOver driver.
 *
 * Sends HTTP requests to the daemon (vo-server) and formats output
 * for terminal display or structured JSON consumption.
 */

import { spawn, spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import {
  DEFAULT_PORT, DEFAULT_CDP_PORT, CLI_TIMEOUT_MS,
  STARTUP_POLL_MS, STARTUP_POLL_MAX,
  sleep, removePidFile, PID_FILE, VO_STATE_FILE,
} from "./vo-core.ts";

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun vo-driver.ts <command> [options]

Session:
  start <url> [--cdp-port N]   Launch browser + VoiceOver + CDP
  stop                         Graceful shutdown
  kill                         Force kill daemon + VoiceOver
  status                       Check daemon state
  enter                        Navigate into web content
  navigate <url>               Go to URL + re-enter web content

Movement:
  next                         Move VO cursor forward
  previous                     Move VO cursor backward

Interaction:
  act                          Activate current item (VO+Space)
  press <key> [modifiers...]   Send raw keystroke (Tab, Return, etc.)
  perform <COMMAND>            Run a VoiceOver command

Queries:
  transcript [--since N] [--clear]   Session transcript
  item-text                          Current focused item
  commands [filter]                  List perform commands

Flags:
  --json        Structured JSON output
  --port N      HTTP port (default: ${DEFAULT_PORT})
  --cdp-port N  Chrome DevTools Protocol port (default: ${DEFAULT_CDP_PORT})`;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface VoData {
  error?: string;
  spoken?: string;
  name?: string;
  role?: string;
  status?: string;
  voiceoverActive?: boolean;
  currentUrl?: string;
  cdpPort?: number;
  entries?: Array<{ index: number; role: string; name: string; spoken: string }>;
  commands?: string[];
  cleared?: number;
}

async function post(base: string, path: string, body?: Record<string, unknown>): Promise<VoData> {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(CLI_TIMEOUT_MS),
  });
  const d: VoData = await r.json();
  if (!r.ok) { console.error(`Error: ${d.error}`); process.exit(1); }
  return d;
}

async function get(base: string, path: string): Promise<VoData> {
  const r = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(CLI_TIMEOUT_MS) });
  if (!r.ok) {
    const d: VoData = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    console.error(`Error: ${d.error}`);
    process.exit(1);
  }
  return r.json();
}

function printVO(d: VoData, jsonFlag: boolean) {
  if (d.error) { console.error(`Error: ${d.error}`); process.exit(1); }
  if (jsonFlag) {
    console.log(JSON.stringify(d));
  } else {
    if (d.spoken) console.log(`Spoken: "${d.spoken}"`);
    if (d.name) console.log(`Name: "${d.name}"`);
    if (d.role) console.log(`Role: "${d.role}"`);
  }
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

export async function cli(args: string[], port: number, cdpPort: number) {
  const [cmd, ...rest] = args;
  const base = `http://127.0.0.1:${port}`;

  const jsonFlag = rest.includes("--json");
  const cleanRest = rest.filter((a) => a !== "--json");

  switch (cmd) {
    case "start": {
      const url = cleanRest[0] || "about:blank";
      console.log("Starting vo-driver...");

      // Already running?
      try {
        const r = await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) {
          const d: VoData = await r.json();
          console.log(`Already running. CDP on ws://127.0.0.1:${d.cdpPort}`);
          if (url !== "about:blank") {
            const nav = await post(base, "/navigate", { url });
            printVO(nav, jsonFlag);
          }
          return;
        }
      } catch {}

      removePidFile();

      // Spawn daemon with URL — it handles navigate + enter internally
      const serveArgs = [
        process.argv[1], "serve",
        "--port", port.toString(),
        "--cdp-port", cdpPort.toString(),
      ];
      if (url !== "about:blank") serveArgs.push(url);

      const child = spawn(process.argv[0], serveArgs, { detached: true, stdio: "ignore" });
      child.unref();

      for (let i = 0; i < STARTUP_POLL_MAX; i++) {
        try {
          const r = await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) });
          if (r.ok) break;
        } catch {}
        if (i === STARTUP_POLL_MAX - 1) { console.error("Server failed to start"); process.exit(1); }
        await sleep(STARTUP_POLL_MS);
      }

      const status = await get(base, "/");
      console.log(`Ready. CDP available on ws://127.0.0.1:${status.cdpPort}`);
      break;
    }

    case "enter":    printVO(await post(base, "/enter"), jsonFlag); break;
    case "next":     printVO(await post(base, "/next"), jsonFlag); break;
    case "previous": printVO(await post(base, "/previous"), jsonFlag); break;
    case "act":      printVO(await post(base, "/act"), jsonFlag); break;

    case "press": {
      if (!cleanRest[0]) { console.error("press requires a key name"); process.exit(1); }
      printVO(await post(base, "/press", {
        key: cleanRest[0],
        modifiers: cleanRest.slice(1).flatMap((m) => m.split(",")).filter(Boolean),
      }), jsonFlag);
      break;
    }

    case "perform": {
      if (!cleanRest[0]) { console.error("perform requires a command name"); process.exit(1); }
      const d = await post(base, "/perform", { command: cleanRest[0] });
      if (!jsonFlag && !d.error) console.log(`Performed: ${cleanRest[0]}`);
      printVO(d, jsonFlag);
      break;
    }

    case "navigate": {
      if (!cleanRest[0]) { console.error("navigate requires a URL"); process.exit(1); }
      const d = await post(base, "/navigate", { url: cleanRest[0] });
      if (!jsonFlag && !d.error) console.log(`Navigated to ${cleanRest[0]}`);
      printVO(d, jsonFlag);
      break;
    }

    case "item-text": printVO(await get(base, "/item-text"), jsonFlag); break;

    case "transcript": {
      const since = cleanRest[0] === "--since" ? cleanRest[1] : null;
      const clear = cleanRest.includes("--clear");

      if (clear) {
        const resp = await fetch(`${base}/transcript`, {
          method: "DELETE",
          signal: AbortSignal.timeout(CLI_TIMEOUT_MS),
        });
        const d: VoData = await resp.json();
        if (jsonFlag) console.log(JSON.stringify(d));
        else console.log(`Cleared ${d.cleared} entries`);
      } else {
        const q = since !== null ? `?since=${since}` : "";
        const d = await get(base, `/transcript${q}`);
        if (jsonFlag) {
          console.log(JSON.stringify(d));
        } else {
          d.entries?.forEach((e) => console.log(`[${e.index}] ${e.role ? `(${e.role}) ` : ""}${e.name || e.spoken}`));
        }
      }
      break;
    }

    case "commands": {
      const f = cleanRest[0] || "";
      const d = await get(base, `/commands?filter=${encodeURIComponent(f)}`);
      if (jsonFlag) {
        console.log(JSON.stringify(d));
      } else {
        d.commands?.forEach((c) => console.log(c));
      }
      break;
    }

    case "status": {
      const d = await get(base, "/");
      if (jsonFlag) console.log(JSON.stringify(d));
      else console.log(`Status: ${d.status}\nVoiceOver: ${d.voiceoverActive}\nURL: ${d.currentUrl || "(none)"}\nCDP: ws://127.0.0.1:${d.cdpPort}`);
      break;
    }

    case "stop": {
      try {
        await fetch(`${base}/stop`, { method: "POST", signal: AbortSignal.timeout(5000) });
        console.log("Stopped");
        return;
      } catch {}
      if (existsSync(PID_FILE)) {
        const pid = parseInt(readFileSync(PID_FILE, "utf-8"), 10);
        process.kill(pid, "SIGTERM");
        console.log(`Sent SIGTERM to ${pid}`);
      } else { console.error("No running server"); process.exit(1); }
      break;
    }

    case "kill": {
      if (!existsSync(PID_FILE)) { console.error("No PID file"); process.exit(1); }
      const pid = parseInt(readFileSync(PID_FILE, "utf-8"), 10);
      process.kill(pid, "SIGKILL");
      // Only quit VoiceOver if we started it
      let weStartedVO = true;
      try {
        const stateData = JSON.parse(readFileSync(VO_STATE_FILE, "utf-8"));
        weStartedVO = stateData.weStartedVoiceOver !== false;
      } catch {}
      if (weStartedVO) {
        spawnSync("osascript", ["-e", 'tell application "VoiceOver" to quit']);
      }
      removePidFile();
      console.log("Killed");
      break;
    }

    case "help": case "--help": case "-h":
      console.log(USAGE);
      break;

    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.error(USAGE);
      process.exit(1);
  }
}

export { USAGE };
