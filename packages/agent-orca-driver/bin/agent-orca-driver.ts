#!/usr/bin/env node
/**
 * agent-orca-driver CLI.
 *
 * Subcommands:
 *   setup           Provision apt packages + Xvfb + AT-SPI2 + ffmpeg + Chromium
 *   start <url>     Spawn Chromium + Orca + daemon
 *   stop            Tear down the running daemon
 *   status          Print daemon status (URL loaded, ports)
 *   doctor          Preflight check
 *   skills get core Print the canonical AGENTS.md reference
 *
 * All subcommands accept --json for agent-friendly structured output.
 */

import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { createOrcaDriver } from "../src/orca/driver.js";
import { startServer } from "../src/server.js";
import { readPidFile } from "../src/lib/runtime-paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Bin lives at dist/bin/agent-orca-driver.js → package root is two levels up.
const PACKAGE_ROOT = resolve(__dirname, "..", "..");

const USAGE = `agent-orca-driver — Composable Orca + Chromium + Xvfb driver

Usage:
  agent-orca-driver <command> [options]

Commands:
  setup                  Install apt packages, Xvfb, AT-SPI2, ffmpeg, Chromium
  start <url>            Spawn Chromium + Orca + daemon and load <url>
  stop                   Tear down the running daemon
  status                 Print daemon status
  doctor                 Preflight check (Xvfb, dbus, at-spi2, orca, chromium)
  skills get core        Print the canonical AGENTS.md reference

Options:
  --port <n>             HTTP daemon port (default: 8001)
  --cdp-port <n>         Chromium CDP port (default: 9223)
  --json                 Emit structured JSON instead of human text
  -h, --help             Show this help
  -v, --version          Show version
`;

interface ParsedArgs {
  command: string;
  positionals: string[];
  port: number;
  cdpPort: number;
  json: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: "",
    positionals: [],
    port: 8001,
    cdpPort: 9223,
    json: false,
    help: false,
    version: false,
  };

  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    switch (a) {
      case "--port": {
        const v = parseInt(argv[++i] || "", 10);
        if (Number.isNaN(v)) die(`Invalid --port value`);
        args.port = v;
        break;
      }
      case "--cdp-port": {
        const v = parseInt(argv[++i] || "", 10);
        if (Number.isNaN(v)) die(`Invalid --cdp-port value`);
        args.cdpPort = v;
        break;
      }
      case "--json":
        args.json = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-v":
      case "--version":
        args.version = true;
        break;
      default:
        if (a.startsWith("--")) die(`Unknown option: ${a}`);
        if (!args.command) args.command = a;
        else args.positionals.push(a);
    }
    i++;
  }
  return args;
}

function die(msg: string, code = 1): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(code);
}

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printAgentsDoc(json: boolean): number {
  const path = join(PACKAGE_ROOT, "AGENTS.md");
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (json) {
      process.stdout.write(JSON.stringify({ ok: false, error: err }) + "\n");
    } else {
      process.stderr.write(`error: cannot read AGENTS.md (${err})\n`);
    }
    return 1;
  }
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, path, content }) + "\n");
  } else {
    process.stdout.write(content);
    if (!content.endsWith("\n")) process.stdout.write("\n");
  }
  return 0;
}

async function cmdStart(args: ParsedArgs): Promise<number> {
  const url = args.positionals[0] || null;
  const driver = createOrcaDriver();
  await startServer(driver, args.port, args.cdpPort, url);
  // startServer installs SIGINT/SIGTERM handlers and keeps the process alive
  // through the listening HTTP server; return is a no-op here.
  return 0;
}

function cmdStop(args: ParsedArgs): number {
  const driver = createOrcaDriver();
  const pid = readPidFile(driver.pidFile);
  if (!pid) {
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: "no pidfile" }) + "\n");
    } else {
      process.stderr.write("no running daemon (pidfile missing)\n");
    }
    return 1;
  }
  try {
    process.kill(pid, "SIGTERM");
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: true, pid }) + "\n");
    } else {
      process.stdout.write(`sent SIGTERM to pid ${pid}\n`);
    }
    return 0;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: err }) + "\n");
    } else {
      process.stderr.write(`failed to signal pid ${pid}: ${err}\n`);
    }
    return 1;
  }
}

async function cmdStatus(args: ParsedArgs): Promise<number> {
  const driver = createOrcaDriver();
  const pid = readPidFile(driver.pidFile);
  if (!pid) {
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: false, running: false }) + "\n");
    } else {
      process.stdout.write("daemon not running\n");
    }
    return 1;
  }

  try {
    const res = await fetch(`http://127.0.0.1:${args.port}/`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json();
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: true, pid, status: body }) + "\n");
    } else {
      process.stdout.write(`pid: ${pid}\n`);
      process.stdout.write(`http: http://127.0.0.1:${args.port}\n`);
      process.stdout.write(JSON.stringify(body, null, 2) + "\n");
    }
    return 0;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: false, pid, error: err }) + "\n");
    } else {
      process.stderr.write(`pid ${pid} present but HTTP unreachable: ${err}\n`);
    }
    return 1;
  }
}

interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

function checkExe(name: string): DoctorCheck {
  const r = spawnSync("which", [name], { encoding: "utf-8" });
  const found = r.status === 0 && (r.stdout || "").trim();
  return {
    name,
    ok: !!found,
    detail: found ? (found as string).trim() : "not found on PATH",
  };
}

function cmdDoctor(args: ParsedArgs): number {
  // Day-1 doctor: a thin preflight. Day-2 expands this to verify Xvfb is
  // running, ffmpeg supports libx264, Playwright Chromium is provisioned, etc.
  const checks: DoctorCheck[] = [
    checkExe("Xvfb"),
    checkExe("xdotool"),
    checkExe("dbus-launch"),
    checkExe("orca"),
    checkExe("ffmpeg"),
    {
      name: "DISPLAY",
      ok: !!process.env.DISPLAY,
      detail: process.env.DISPLAY || "unset",
    },
    {
      name: "DBUS_SESSION_BUS_ADDRESS",
      ok: !!process.env.DBUS_SESSION_BUS_ADDRESS,
      detail: process.env.DBUS_SESSION_BUS_ADDRESS || "unset",
    },
  ];

  const allOk = checks.every((c) => c.ok);
  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: allOk, checks }) + "\n");
  } else {
    for (const c of checks) {
      process.stdout.write(`  [${c.ok ? "OK" : "MISSING"}] ${c.name}: ${c.detail}\n`);
    }
    process.stdout.write(allOk ? "\nall checks passed\n" : "\nsome checks failed — run: agent-orca-driver setup\n");
  }
  return allOk ? 0 : 1;
}

function cmdSetup(args: ParsedArgs): number {
  // Day-1 stub. The full setup.sh provisioner (apt + ffmpeg + Playwright
  // Chromium + helper scripts) lands in the next slice — see
  // docs/agent-orca-driver-plan.md §11 day 2.
  const msg =
    "setup is not yet implemented in this slice — run drivers/orca/setup.sh from the parent repo, or wait for the Day-2 slice that ships scripts/setup.sh.";
  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
  } else {
    process.stderr.write(msg + "\n");
  }
  return 2;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.version) {
    process.stdout.write(getVersion() + "\n");
    return 0;
  }

  if (args.help || !args.command) {
    process.stdout.write(USAGE);
    return args.help ? 0 : 1;
  }

  switch (args.command) {
    case "setup":
      return cmdSetup(args);
    case "start":
      return cmdStart(args);
    case "stop":
      return cmdStop(args);
    case "status":
      return cmdStatus(args);
    case "doctor":
      return cmdDoctor(args);
    case "skills": {
      const sub = args.positionals[0];
      const target = args.positionals[1];
      if (sub === "get" && target === "core") {
        return printAgentsDoc(args.json);
      }
      die(`unknown subcommand: skills ${sub ?? ""} ${target ?? ""}\n${USAGE}`);
      return 1;
    }
    default:
      die(`unknown command: ${args.command}\n${USAGE}`);
      return 1;
  }
}

main().then(
  (code) => {
    if (code !== 0) process.exit(code);
  },
  (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: ${msg}\n`);
    process.exit(1);
  },
);
