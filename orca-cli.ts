/**
 * CLI client for the Orca driver on Linux.
 *
 * Sends HTTP requests to the daemon (orca-server) and formats output.
 * Mirrors vo-cli.ts with the same commands and output format.
 */

import { spawn, spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import {
  DEFAULT_PORT, DEFAULT_CDP_PORT, CLI_TIMEOUT_MS,
  STARTUP_POLL_MS, STARTUP_POLL_MAX,
  sleep, removePidFile, PID_FILE, ORCA_STATE_FILE,
} from "./orca-core.ts";
import type {
  VoResult, StatusResponse, TranscriptResponse,
  ClearTranscriptResponse, CommandsResponse,
} from "./orca-types.ts";

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun orca-driver.ts <command> [options]

Session:
  start <url> [--cdp-port N]   Launch browser + Orca + CDP
  stop                         Graceful shutdown
  kill                         Force kill daemon + Orca
  status                       Check daemon state
  enter                        Re-focus browser for Orca
  navigate <url>               Go to URL

Movement:
  next                         Next item (Down in browse mode)
  previous                     Previous item (Up in browse mode)

Interaction:
  act                          Activate current item (Enter)
  press <key> [modifiers...]   Send raw keystroke (Tab, Return, etc.)
  perform <COMMAND>            Run an Orca browse-mode command

Queries:
  transcript [--since N] [--clear]   Session transcript
  item-text                          Current focused item (AT-SPI2)
  commands [filter]                  List perform commands

Flags:
  --json        Structured JSON output
  --port N      HTTP port (default: ${DEFAULT_PORT})
  --cdp-port N  Chrome DevTools Protocol port (default: ${DEFAULT_CDP_PORT})`;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

async function post(base: string, path: string, body?: Record<string, unknown>): Promise<VoResult> {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(CLI_TIMEOUT_MS),
  });
  const d: VoResult = await r.json();
  if (!r.ok) throw new CliError("error" in d ? d.error : `HTTP ${r.status}`);
  return d;
}

async function get<T>(base: string, path: string): Promise<T> {
  const r = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(CLI_TIMEOUT_MS) });
  if (!r.ok) {
    const d = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    throw new CliError(typeof d.error === "string" ? d.error : `HTTP ${r.status}`);
  }
  return r.json();
}

function printVO(d: VoResult, jsonFlag: boolean) {
  if ("error" in d) throw new CliError(d.error);
  if (jsonFlag) {
    console.log(JSON.stringify(d));
  } else {
    if (d.spoken) console.log(`Spoken: "${d.spoken}"`);
    if (d.name) console.log(`Name: "${d.name}"`);
    if (d.role) console.log(`Role: "${d.role}"`);
    if (d.state?.length) console.log(`State: ${d.state.join(", ")}`);
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

  try {
    switch (cmd) {
      case "start": {
        const url = cleanRest[0] || "about:blank";
        console.log("Starting orca-driver...");

        // Already running?
        try {
          const r = await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) });
          if (r.ok) {
            const d: StatusResponse = await r.json();
            console.log(`Already running. CDP on ws://127.0.0.1:${d.cdpPort}`);
            if (url !== "about:blank") {
              const nav = await post(base, "/navigate", { url });
              printVO(nav, jsonFlag);
            }
            return;
          }
        } catch {}

        removePidFile();

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
          if (i === STARTUP_POLL_MAX - 1) throw new CliError("Server failed to start");
          await sleep(STARTUP_POLL_MS);
        }

        const status = await get<StatusResponse>(base, "/");
        console.log(`Ready. CDP available on ws://127.0.0.1:${status.cdpPort}`);
        break;
      }

      case "enter":    printVO(await post(base, "/enter"), jsonFlag); break;
      case "next":     printVO(await post(base, "/next"), jsonFlag); break;
      case "previous": printVO(await post(base, "/previous"), jsonFlag); break;
      case "act":      printVO(await post(base, "/act"), jsonFlag); break;

      case "press": {
        if (!cleanRest[0]) throw new CliError("press requires a key name");
        printVO(await post(base, "/press", {
          key: cleanRest[0],
          modifiers: cleanRest.slice(1).flatMap((m) => m.split(",")).filter(Boolean),
        }), jsonFlag);
        break;
      }

      case "perform": {
        if (!cleanRest[0]) throw new CliError("perform requires a command name");
        const d = await post(base, "/perform", { command: cleanRest[0] });
        if (!jsonFlag && !("error" in d)) console.log(`Performed: ${cleanRest[0]}`);
        printVO(d, jsonFlag);
        break;
      }

      case "navigate": {
        if (!cleanRest[0]) throw new CliError("navigate requires a URL");
        const d = await post(base, "/navigate", { url: cleanRest[0] });
        if (!jsonFlag && !("error" in d)) console.log(`Navigated to ${cleanRest[0]}`);
        printVO(d, jsonFlag);
        break;
      }

      case "item-text": printVO(await get<VoResult>(base, "/item-text"), jsonFlag); break;

      case "transcript": {
        const since = cleanRest[0] === "--since" ? cleanRest[1] : null;
        const clear = cleanRest.includes("--clear");

        if (clear) {
          const resp = await fetch(`${base}/transcript`, {
            method: "DELETE",
            signal: AbortSignal.timeout(CLI_TIMEOUT_MS),
          });
          const d: ClearTranscriptResponse = await resp.json();
          if (jsonFlag) console.log(JSON.stringify(d));
          else console.log(`Cleared ${d.cleared} entries`);
        } else {
          const q = since !== null ? `?since=${since}` : "";
          const d = await get<TranscriptResponse>(base, `/transcript${q}`);
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
        const d = await get<CommandsResponse>(base, `/commands?filter=${encodeURIComponent(f)}`);
        if (jsonFlag) {
          console.log(JSON.stringify(d));
        } else {
          d.commands?.forEach((c) => console.log(c));
        }
        break;
      }

      case "status": {
        const d = await get<StatusResponse>(base, "/");
        if (jsonFlag) console.log(JSON.stringify(d));
        else console.log(`Status: ${d.status}\nOrca: ${d.voiceoverActive}\nURL: ${d.currentUrl || "(none)"}\nCDP: ws://127.0.0.1:${d.cdpPort}`);
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
        } else {
          throw new CliError("No running server");
        }
        break;
      }

      case "kill": {
        if (!existsSync(PID_FILE)) throw new CliError("No PID file");
        const pid = parseInt(readFileSync(PID_FILE, "utf-8"), 10);
        process.kill(pid, "SIGKILL");

        let weStartedOrca = true;
        try {
          const stateData = JSON.parse(readFileSync(ORCA_STATE_FILE, "utf-8"));
          weStartedOrca = stateData.weStartedOrca !== false;
        } catch {}

        if (weStartedOrca) {
          spawnSync("pkill", ["-x", "orca"]);
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
  } catch (e) {
    if (e instanceof CliError) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

export { USAGE };
