/**
 * Unified CLI client for the screen reader driver.
 *
 * Sends HTTP requests to the daemon and formats output for terminal display
 * or structured JSON consumption. Works with both VoiceOver and Orca.
 */

import { existsSync, readFileSync } from "fs";
import { spawnSync } from "child_process";
import type { ScreenReaderDriver } from "./drivers/interface.ts";
import { isVoError, type VoResult, type TranscriptEntry } from "./drivers/types.ts";

// ---------------------------------------------------------------------------
// Config from driver
// ---------------------------------------------------------------------------

const STARTUP_POLL_MS = 200;
const STARTUP_POLL_MAX = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function makeUsage(driverName: string, screenReader: string): string {
  return `Usage: bun ${driverName} <command> [options]

Commands:
  start <url> [--cdp-port N]   Launch browser + ${screenReader} + CDP
  stop                         Graceful shutdown
  kill                         Force kill daemon + ${screenReader}
  status                       Show daemon state

  enter                        Focus browser for ${screenReader}
  navigate <url>               Go to URL

  loading-state                Check loading state a11y (4.1.3 patterns)
  observe [--settle N]         Start DOM MutationObserver (default settle: 2000ms)
  observe-status               Check if DOM has settled
  observe-stop                 Stop observing
  wait-for-selector <sel> [--state S] [--timeout N]
                               Wait for CSS selector (visible|attached|detached|hidden)

  next                         Move to next item
  previous                     Move to previous item
  act                          Activate current item
  press <key> [modifiers...]   Send keystroke
  perform <COMMAND>            Run a ${screenReader} command

  transcript [--since N] [--clear]   View/clear session transcript
  item-text                          Current focused item
  commands [filter]                  List available commands

Flags:
  --json                       Output structured JSON
  --port N                     Override daemon port
  --cdp-port N                 Override CDP port
  --help                       Show this help
`;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

class CliError extends Error {}

async function post(port: number, path: string, body?: object, timeout = 30_000): Promise<any> {
  const opts: RequestInit = {
    method: "POST",
    signal: AbortSignal.timeout(timeout),
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new CliError(data?.error || `HTTP ${res.status}`);
  return data;
}

async function get(port: number, path: string, timeout = 30_000): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    signal: AbortSignal.timeout(timeout),
  });
  const data = await res.json();
  if (!res.ok) throw new CliError(data?.error || `HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function printVO(r: VoResult, jsonMode: boolean) {
  if (jsonMode) {
    console.log(JSON.stringify(r));
    return;
  }
  if (isVoError(r)) {
    console.error(`Error: ${r.error}`);
    if (r.suggestion) console.error(`  Suggestion: ${r.suggestion}`);
  } else {
    if (r.spoken) console.log(r.spoken);
    else console.log(`[${r.role || "unknown"}] ${r.name || "(no name)"}`);
  }
}

function printTranscript(entries: TranscriptEntry[], jsonMode: boolean) {
  if (jsonMode) {
    console.log(JSON.stringify(entries));
    return;
  }
  if (entries.length === 0) {
    console.log("(empty transcript)");
    return;
  }
  for (const e of entries) {
    const prefix = `[${e.index}]`;
    if (e.spoken) console.log(`${prefix} ${e.spoken}`);
    else console.log(`${prefix} [${e.role}] ${e.name}`);
  }
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

export const USAGE_VO = makeUsage("drivers/voiceover/driver.ts", "VoiceOver");
export const USAGE_ORCA = makeUsage("drivers/orca/driver.ts", "Orca");
export const USAGE_UNIFIED = makeUsage("drivers/driver.ts", "screen reader");

export async function cli(args: string[], driver: ScreenReaderDriver, usage: string) {
  const port = (() => {
    const i = args.indexOf("--port");
    return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : driver.defaultPort;
  })();
  const cdpPort = (() => {
    const i = args.indexOf("--cdp-port");
    return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : driver.defaultCdpPort;
  })();
  const jsonMode = args.includes("--json");

  const positional = args.filter(
    (a, i, arr) => !a.startsWith("--") && !(i > 0 && arr[i - 1]?.startsWith("--")),
  );
  const cmd = positional[0];

  if (!cmd) {
    console.log(usage);
    return;
  }

  try {
    switch (cmd) {
      case "start": {
        const url = positional[1];
        if (!url) throw new CliError("Missing URL. Usage: start <url>");
        console.log(`Starting ${driver.name} driver...`);

        // Spawn the daemon
        const child = Bun.spawn(
          [
            "bun",
            process.argv[1],
            "serve",
            url,
            "--port",
            String(port),
            "--cdp-port",
            String(cdpPort),
          ],
          {
            stdio: ["ignore", "pipe", "pipe"],
            env: process.env,
          },
        );

        // Poll until server is ready
        for (let i = 0; i < STARTUP_POLL_MAX; i++) {
          try {
            const d = await get(port, "/", 2000);
            if (d.status === "running") {
              console.log(`Ready. CDP available on ws://127.0.0.1:${d.cdpPort}`);
              return;
            }
          } catch {}
          await sleep(STARTUP_POLL_MS);
        }
        throw new CliError("Server failed to start. Check " + driver.logFile);
      }

      case "serve":
        // Internal — called by start
        throw new CliError("'serve' is internal. Use 'start' to launch the daemon.");

      case "stop":
        await post(port, "/stop");
        console.log("Stopped");
        break;

      case "kill": {
        if (!existsSync(driver.pidFile)) throw new CliError("No PID file");
        const pid = parseInt(readFileSync(driver.pidFile, "utf-8"), 10);
        process.kill(pid, "SIGKILL");

        // Platform-specific cleanup
        if (driver.platform === "macos") {
          // VoiceOver: restore speech rate and quit VoiceOver
          try {
            const stateData = JSON.parse(readFileSync(driver.stateFile, "utf-8"));
            if (typeof stateData.originalSpeechRate === "string") {
              const key =
                "SCRCategories_SCRCategorySystemWide_SCRSpeechLanguages_default_SCRSpeechComponentSettings_SCRRateAsPercent";
              spawnSync("defaults", [
                "write",
                "com.apple.VoiceOver4/default",
                key,
                "-int",
                stateData.originalSpeechRate,
              ]);
            }
            if (stateData.weStartedVoiceOver !== false) {
              spawnSync("osascript", ["-e", 'tell application "VoiceOver" to quit']);
            }
          } catch {}
        } else if (driver.platform === "linux") {
          // Orca: kill the orca process
          try {
            const stateData = JSON.parse(readFileSync(driver.stateFile, "utf-8"));
            if (stateData.weStartedOrca !== false) {
              spawnSync("pkill", ["-x", "orca"]);
            }
          } catch {}
        }
        driver.removePidFile();
        console.log("Killed");
        break;
      }

      case "status": {
        const d = await get(port, "/");
        if (jsonMode) {
          console.log(JSON.stringify(d));
        } else
          console.log(
            `Status: ${d.status}\n${driver.name}: ${d.voiceoverActive}\nURL: ${d.currentUrl || "(none)"}\nCDP: ws://127.0.0.1:${d.cdpPort}`,
          );
        break;
      }

      case "enter":
        printVO(await post(port, "/enter"), jsonMode);
        break;
      case "next":
        printVO(await post(port, "/next"), jsonMode);
        break;
      case "previous":
        printVO(await post(port, "/previous"), jsonMode);
        break;
      case "act":
        printVO(await post(port, "/act"), jsonMode);
        break;
      case "item-text":
        printVO(await get(port, "/item-text"), jsonMode);
        break;

      case "navigate": {
        const url = positional[1];
        if (!url) throw new CliError("Missing URL");
        printVO(await post(port, "/navigate", { url }), jsonMode);
        break;
      }

      // ---------------------------------------------------------------
      // Loading state & DOM observation
      // ---------------------------------------------------------------

      case "loading-state": {
        const d = await get(port, "/loading-state");
        if (jsonMode) {
          console.log(JSON.stringify(d));
        } else {
          console.log(d.summary);
          if (d.ariaBusyElements.length > 0) {
            console.log("\naria-busy elements:");
            d.ariaBusyElements.forEach((e: any) => console.log(`  ${e.selector} (${e.tagName})`));
          }
          if (d.loadingIndicators.length > 0) {
            console.log("\nLoading indicators:");
            d.loadingIndicators.forEach((e: any) =>
              console.log(`  ${e.selector} — ${e.hasAccessibleName ? `name: "${e.accessibleName}"` : "NO accessible name"} (${e.detectedBy})`));
          }
          if (d.liveRegions.length > 0) {
            console.log("\nLive regions:");
            d.liveRegions.forEach((e: any) =>
              console.log(`  ${e.selector} — aria-live="${e.ariaLive}" ${e.role ? `role="${e.role}"` : ""} "${e.textContent}"`));
          }
          if (d.statusRoles.length > 0) {
            console.log("\nStatus roles:");
            d.statusRoles.forEach((e: any) =>
              console.log(`  ${e.selector} — role="${e.role}" ${e.hasAccessibleName ? "✓ named" : "✗ unnamed"}`));
          }
        }
        break;
      }

      case "observe": {
        const settleIdx = args.indexOf("--settle");
        const settleMs = settleIdx >= 0 && args[settleIdx + 1] ? parseInt(args[settleIdx + 1], 10) : undefined;
        const d = await post(port, "/observe", settleMs ? { settleMs } : {});
        console.log(`Observer started (settle threshold: ${d.settleMs}ms)`);
        break;
      }

      case "observe-status": {
        const d = await get(port, "/observe");
        if (jsonMode) {
          console.log(JSON.stringify(d));
        } else {
          const status = d.settled ? "SETTLED" : "MUTATING";
          console.log(`DOM: ${status} | mutations: ${d.mutationCount} | since last: ${d.msSinceLastMutation}ms | elapsed: ${d.elapsed}ms`);
        }
        if (d.settled) process.exit(0);
        else process.exit(2); // exit 2 = not settled yet (distinguishable from error)
        break;
      }

      case "observe-stop": {
        const d = await fetch(`http://127.0.0.1:${port}/observe`, {
          method: "DELETE",
          signal: AbortSignal.timeout(driver.cliTimeoutMs),
        }).then(r => r.json());
        if (jsonMode) {
          console.log(JSON.stringify(d));
        } else {
          console.log(`Observer stopped. Total mutations: ${d.mutationCount}, settled: ${d.settled}`);
        }
        break;
      }

      case "wait-for-selector": {
        const selector = positional[1];
        if (!selector) throw new CliError("Missing CSS selector");
        const stateIdx = args.indexOf("--state");
        const state = stateIdx >= 0 && args[stateIdx + 1] ? args[stateIdx + 1] : undefined;
        const timeoutIdx = args.indexOf("--timeout");
        const timeout = timeoutIdx >= 0 && args[timeoutIdx + 1] ? parseInt(args[timeoutIdx + 1], 10) : undefined;
        const d = await post(port, "/wait-for-selector", { selector, state, timeout }, timeout ? timeout + 5000 : 35_000);
        if (jsonMode) {
          console.log(JSON.stringify(d));
        } else {
          console.log(d.success ? `OK: ${d.detail}` : `Timeout: ${d.detail}`);
        }
        if (!d.success) process.exit(1);
        break;
      }

      case "perform": {
        const command = positional[1];
        if (!command) throw new CliError("Missing command name");
        printVO(await post(port, "/perform", { command }), jsonMode);
        break;
      }

      case "press": {
        const key = positional[1];
        if (!key) throw new CliError("Missing key");
        const modifiers = positional.slice(2);
        printVO(await post(port, "/press", { key, modifiers }), jsonMode);
        break;
      }

      case "transcript": {
        if (args.includes("--clear")) {
          const d = await fetch(`http://127.0.0.1:${port}/transcript`, {
            method: "DELETE",
            signal: AbortSignal.timeout(driver.cliTimeoutMs),
          }).then((r) => r.json());
          console.log(`Cleared ${d.cleared} entries`);
        } else {
          const sinceIdx = args.indexOf("--since");
          const since = sinceIdx >= 0 && args[sinceIdx + 1] ? `?since=${args[sinceIdx + 1]}` : "";
          const d = await get(port, `/transcript${since}`);
          printTranscript(d.entries, jsonMode);
        }
        break;
      }

      case "commands": {
        const filter = positional[1] ? `?filter=${encodeURIComponent(positional[1])}` : "";
        const d = await get(port, `/commands${filter}`);
        if (jsonMode) console.log(JSON.stringify(d.commands));
        else
          d.commands.forEach((c: string) => {
            console.log(`  ${c}`);
          });
        break;
      }

      case "help":
      case "--help":
      case "-h":
        console.log(usage);
        break;

      default:
        console.error(`Unknown command: ${cmd}\n`);
        console.error(usage);
        process.exit(1);
    }
  } catch (e) {
    if (e instanceof CliError) {
      console.error(`Error: ${e.message}`);
    } else {
      console.error(e instanceof Error ? e.message : String(e));
    }
    process.exit(1);
  }
}
