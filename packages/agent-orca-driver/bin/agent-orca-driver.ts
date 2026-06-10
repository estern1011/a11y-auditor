#!/usr/bin/env node
/**
 * agent-orca-driver CLI.
 *
 * Subcommands:
 *   setup           Run scripts/setup.sh: apt packages + ffmpeg + Playwright Chromium
 *   start <url>     Spawn Chromium + Orca + daemon
 *   stop            Tear down the running daemon
 *   status          Print daemon status (URL loaded, ports)
 *   doctor          Preflight check
 *   skills get core Print the canonical AGENTS.md reference
 *
 * All subcommands accept --json for agent-friendly structured output.
 */

import { spawn, spawnSync } from "child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { createOrcaDriver } from "../src/orca/driver.js";
import { startServer, isAllowedNavigationUrl } from "../src/server.js";
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
  // Same allow-list the /navigate HTTP route applies. Without this check the
  // initial page.goto() in initialize() would happily accept file:// or
  // chrome:// URLs, turning the CLI into a local-file / browser-internal
  // read primitive — exactly what the /navigate guard exists to prevent.
  if (url !== null && !isAllowedNavigationUrl(url)) {
    const msg = "URL scheme not allowed (http/https/data only)";
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
    } else {
      process.stderr.write(`error: ${msg}\n`);
    }
    return 2;
  }
  const driver = createOrcaDriver();
  await startServer(driver, args.port, args.cdpPort, url);
  // startServer installs SIGINT/SIGTERM handlers and keeps the process alive
  // through the listening HTTP server; return is a no-op here.
  return 0;
}

async function cmdStop(args: ParsedArgs): Promise<number> {
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

  // Prefer the HTTP /stop endpoint: only the actual daemon answers there,
  // so this avoids the "stale pidfile + PID reuse → SIGTERM hits an unrelated
  // process" foot-gun that a bare `process.kill(pid)` falls into. If the HTTP
  // path works, the daemon's own SIGINT/SIGTERM handler runs cleanup() and
  // removes the pidfile, so a stale file from this run won't leak.
  try {
    const res = await fetch(`http://127.0.0.1:${args.port}/stop`, {
      method: "POST",
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) {
      if (args.json) {
        process.stdout.write(JSON.stringify({ ok: true, pid, method: "http" }) + "\n");
      } else {
        process.stdout.write(`daemon stopped via HTTP /stop (pid ${pid})\n`);
      }
      return 0;
    }
  } catch {
    /* fall through to the verified-SIGTERM path */
  }

  // HTTP didn't work — daemon is probably wedged. Verify the PID belongs to a
  // process whose cmdline mentions `agent-orca-driver` BEFORE signalling, so
  // a stale pidfile pointing at someone else's PID after reuse won't take
  // out an unrelated process.
  let isOurs = false;
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8").replace(/\0/g, " ");
    isOurs = cmdline.includes("agent-orca-driver");
  } catch { /* /proc not available or process gone */ }

  if (!isOurs) {
    const reason = "pidfile is stale (process is not agent-orca-driver); refusing to signal";
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: false, pid, error: reason }) + "\n");
    } else {
      process.stderr.write(`${reason} (pid ${pid})\n`);
    }
    // Best-effort: remove the stale pidfile so future status/stop calls don't
    // keep re-attempting against the wrong PID.
    try { driver.removePidFile(); } catch { /* ignore */ }
    return 1;
  }

  try {
    process.kill(pid, "SIGTERM");
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: true, pid, method: "sigterm" }) + "\n");
    } else {
      process.stdout.write(`sent SIGTERM to verified daemon (pid ${pid})\n`);
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

// Verify the ffmpeg build advertises the libx264 encoder — the /live stream
// (Day 3) encodes the Xvfb framebuffer as h264.
function checkLibx264(): DoctorCheck {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], {
    encoding: "utf-8",
    timeout: 10_000,
  });
  if (r.status !== 0) {
    return { name: "ffmpeg libx264", ok: false, detail: "ffmpeg not runnable" };
  }
  const ok = (r.stdout || "").includes("libx264");
  return {
    name: "ffmpeg libx264",
    ok,
    detail: ok ? "h264 encoder available" : "libx264 encoder NOT in this ffmpeg build",
  };
}

// Start a throwaway Xvfb so doctor can validate the *headful* Chromium path
// (what the daemon actually uses) when no display is present. Returns the
// display + a cleanup fn, or null if Xvfb couldn't be brought up.
function startTempXvfb(): { display: string; cleanup: () => void } | null {
  if (spawnSync("which", ["Xvfb"], { encoding: "utf-8" }).status !== 0) return null;
  const display = ":99";
  try {
    spawnSync("rm", ["-f", "/tmp/.X99-lock"], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  const proc = spawn("Xvfb", [display, "-screen", "0", "1280x1024x24", "-ac"], {
    stdio: "ignore",
  });
  const start = Date.now();
  while (Date.now() - start < 2500) {
    const r = spawnSync("xdotool", ["getdisplaygeometry"], {
      env: { ...process.env, DISPLAY: display },
      stdio: "pipe",
      timeout: 1000,
    });
    if (r.status === 0) {
      return {
        display,
        cleanup: () => {
          try {
            proc.kill("SIGTERM");
          } catch {
            /* ignore */
          }
        },
      };
    }
  }
  try {
    proc.kill("SIGKILL");
  } catch {
    /* ignore */
  }
  return null;
}

// Verify Chromium isn't just present but actually *launches* — and launches
// the way the daemon does: HEADFUL (headless:false), which needs the X/GTK
// runtime, a different (larger) shared-lib set than headless. An
// existence-only or headless-only check would pass on a fresh image with
// incomplete OS deps and let `start` be the first thing to fail. If no
// display is available, doctor spins up a throwaway Xvfb so it can still
// exercise the headful path. Honors PLAYWRIGHT_BROWSERS_PATH so doctor and
// the daemon agree on where the browser lives.
async function checkChromium(): Promise<DoctorCheck> {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    return {
      name: "Playwright Chromium",
      ok: false,
      detail: `playwright not importable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const exe = chromium.executablePath();
  if (!exe || !existsSync(exe)) {
    return {
      name: "Playwright Chromium",
      ok: false,
      detail: `browser binary missing (${exe || "no path"}) — run: agent-orca-driver setup`,
    };
  }

  // The daemon ALWAYS launches headful (core.ts:initialize calls chromium
  // .launch with headless:false). If doctor can't reproduce that headful
  // path it must FAIL, not silently fall back to headless and exit 0 —
  // an operator gets a green doctor result followed immediately by a
  // failed `start`, with no signal beforehand. The two real reasons the
  // headful path fails are (a) no DISPLAY AND we can't bring up an Xvfb
  // (Xvfb missing, :99 occupied, container with no /tmp/.X11-unix), and
  // (b) Chromium launches headless fine but trips on missing X/GTK
  // libs when it actually tries headful. Both should surface here.
  let tempXvfb: { display: string; cleanup: () => void } | null = null;
  const hadDisplay = !!process.env.DISPLAY;
  if (!hadDisplay) {
    tempXvfb = startTempXvfb();
    if (tempXvfb) process.env.DISPLAY = tempXvfb.display;
  }
  if (!process.env.DISPLAY) {
    return {
      name: "Playwright Chromium",
      ok: false,
      detail:
        "no DISPLAY and could not start a temporary Xvfb — `start` will fail the same way. Install Xvfb (`agent-orca-driver setup`), free :99, or run inside a session that already has a display.",
    };
  }

  let browser;
  try {
    // Match the daemon's launch flags (core.ts initialize) instead of using
    // the more-permissive --no-sandbox/--disable-gpu pair. Otherwise doctor
    // can pass on a container missing the sandbox helper while `start` is
    // still the first thing to actually fail. Genuine sandbox shortfalls
    // surface here, where the operator expects them. Headless:false
    // unconditionally — the no-DISPLAY case already returned above.
    browser = await chromium.launch({ headless: false });
    const version = browser.version();
    return { name: "Playwright Chromium", ok: true, detail: `launches headful (v${version})` };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0];
    return {
      name: "Playwright Chromium",
      ok: false,
      detail: `binary present but failed to launch headful (missing OS deps?): ${msg}`,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* best-effort */
      }
    }
    if (tempXvfb) {
      tempXvfb.cleanup();
      if (!hadDisplay) delete process.env.DISPLAY;
    }
  }
}

// Soft check: if a display is available, confirm ffmpeg can grab one frame
// off it via x11grab. Skipped (and treated as non-fatal) when DISPLAY is
// unset — doctor runs after `setup`, before any daemon has started Xvfb.
function checkX11grab(): DoctorCheck {
  const display = process.env.DISPLAY;
  if (!display) {
    return { name: "ffmpeg x11grab", ok: true, detail: "skipped (no DISPLAY yet)" };
  }
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-f", "x11grab", "-i", display, "-frames:v", "1", "-f", "null", "-"],
    { encoding: "utf-8", timeout: 15_000 },
  );
  const ok = r.status === 0;
  return {
    name: "ffmpeg x11grab",
    ok,
    detail: ok ? `captured a frame from ${display}` : `failed against ${display}: ${(r.stderr || "").trim().split("\n")[0] || "unknown"}`,
  };
}

async function cmdDoctor(args: ParsedArgs): Promise<number> {
  // Hard checks gate the exit code; soft checks are informational so that
  // `doctor` exits 0 right after `setup` (before any display/daemon exists).
  const hard: DoctorCheck[] = [
    checkExe("Xvfb"),
    checkExe("xdotool"),
    checkExe("dbus-launch"),
    checkExe("orca"),
    checkExe("ffmpeg"),
    checkExe("pulseaudio"),
    checkLibx264(),
    await checkChromium(),
  ];
  const soft: DoctorCheck[] = [
    {
      name: "DISPLAY",
      ok: !!process.env.DISPLAY,
      detail: process.env.DISPLAY || "unset (the daemon starts Xvfb on :99)",
    },
    {
      name: "DBUS_SESSION_BUS_ADDRESS",
      ok: !!process.env.DBUS_SESSION_BUS_ADDRESS,
      detail: process.env.DBUS_SESSION_BUS_ADDRESS || "unset (the daemon launches dbus)",
    },
    checkX11grab(),
  ];

  const allOk = hard.every((c) => c.ok);
  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: allOk, hard, soft }) + "\n");
  } else {
    process.stdout.write("required:\n");
    for (const c of hard) {
      process.stdout.write(`  [${c.ok ? "OK" : "MISSING"}] ${c.name}: ${c.detail}\n`);
    }
    process.stdout.write("informational:\n");
    for (const c of soft) {
      process.stdout.write(`  [${c.ok ? "OK" : "info"}] ${c.name}: ${c.detail}\n`);
    }
    process.stdout.write(
      allOk ? "\nall required checks passed\n" : "\nsome required checks failed — run: agent-orca-driver setup\n",
    );
  }
  return allOk ? 0 : 1;
}

function cmdSetup(args: ParsedArgs): number {
  const script = join(PACKAGE_ROOT, "scripts", "setup.sh");
  if (!existsSync(script)) {
    const msg = `setup.sh not found at ${script}`;
    if (args.json) process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
    else process.stderr.write(msg + "\n");
    return 1;
  }

  if (args.json) {
    // apt + Playwright produce far more than spawnSync's default ~1 MiB
    // maxBuffer, which would ENOBUFS-kill the child. Stream combined output
    // to a temp file (no buffer limit), then read it back for the JSON blob.
    const logPath = join(tmpdir(), `agent-orca-driver-setup-${process.pid}-${Date.now()}.log`);
    const fd = openSync(logPath, "w");
    let r;
    try {
      r = spawnSync("bash", [script], { stdio: ["ignore", fd, fd] });
    } finally {
      closeSync(fd);
    }
    let output = "";
    try {
      output = readFileSync(logPath, "utf-8");
    } catch {
      /* best-effort */
    }
    try {
      rmSync(logPath, { force: true });
    } catch {
      /* best-effort */
    }
    const ok = r.status === 0;
    process.stdout.write(JSON.stringify({ ok, code: r.status, output }) + "\n");
    return ok ? 0 : (r.status ?? 1);
  }

  // Human mode: stream the provisioner's output live.
  const r = spawnSync("bash", [script], { stdio: "inherit" });
  return r.status ?? 1;
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
      return await cmdDoctor(args);
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
