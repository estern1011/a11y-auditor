#!/usr/bin/env bun
/**
 * Baseline evidence collector — gathers a standard set of accessibility
 * evidence from a page in a single command.
 *
 * Talks to a running screen reader driver via its HTTP API and uses
 * agent-browser for DOM snapshots and screenshots.
 *
 * Usage:
 *   bun collect.ts <url> [options]
 *   bun collect.ts https://example.com
 *   bun collect.ts https://example.com --tools axe,sr,screenshot
 *   bun collect.ts https://example.com --port 7483 --cdp-port 9222
 *   bun collect.ts https://example.com --tabs 15
 *   bun collect.ts https://example.com --out runs/abc
 *
 * Outputs:
 *   Default: JSON to stdout with full evidence envelope.
 *   With --out <dir>: writes <dir>/evidence.json (thin manifest) and
 *     <dir>/artifacts/{html.html,snapshot.txt,screenshot.png,axe.json},
 *     printing only the evidence.json path to stdout. Used by the LangGraph
 *     runner so large blobs never pass through a pipe.
 * The driver must already be running (bun {sr-driver} start <url>).
 */

import { parseArgs } from "util";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEFAULT_PORT as VO_PORT, DEFAULT_CDP_PORT as VO_CDP } from "./drivers/voiceover/core.ts";
import { DEFAULT_PORT as ORCA_PORT, DEFAULT_CDP_PORT as ORCA_CDP } from "./drivers/orca/core.ts";

// ---------------------------------------------------------------------------
// Platform defaults
// ---------------------------------------------------------------------------

const IS_MAC = process.platform === "darwin";
const DEFAULT_PORT = IS_MAC ? VO_PORT : ORCA_PORT;
const DEFAULT_CDP_PORT = IS_MAC ? VO_CDP : ORCA_CDP;

// ---------------------------------------------------------------------------
// Evidence shape
// ---------------------------------------------------------------------------

export interface Evidence {
  url: string;
  html: string;
  snapshot: string;
  axe?: {
    violations: any[];
    incomplete: any[];
    passes: number;
    inapplicable: number;
  };
  sr?: {
    onLoad: any[];
    tabSequence: any[];
    landmarks: any[];
    headings: any[];
    links: any[];
  };
  screenshot?: string;
}

export interface EvidenceManifest {
  url: string;
  /** Relative-to-outDir paths for the large blobs. */
  artifacts: Record<string, string>;
  /** Inline SR transcripts (small, structured). */
  sr?: Evidence["sr"];
  /** Cheap heuristics the runner uses to route the graph. */
  signals: { needsAuth: boolean };
}

// ---------------------------------------------------------------------------
// Heuristics (exported for runner reuse + unit tests)
// ---------------------------------------------------------------------------

export function detectNeedsAuth(ev: Pick<Evidence, "url" | "html">): boolean {
  // Path-level heuristic: common auth routes.
  let path = "";
  try {
    path = new URL(ev.url).pathname.toLowerCase();
  } catch {
    // Non-absolute URL — skip URL check.
  }
  if (/(^|\/)(login|signin|sign-in|log-in|auth|authenticate|account\/login)(\/|$)/.test(path)) {
    return true;
  }
  // DOM-level heuristic: a password input signals a login form on the page.
  if (/<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(ev.html)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// CLI entry — only runs when invoked directly. Importing this module (e.g.
// from tests or the runner) must not trigger arg parsing or network I/O.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  await runCli();
}

async function runCli() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string", default: String(DEFAULT_PORT) },
      "cdp-port": { type: "string", default: String(DEFAULT_CDP_PORT) },
      tools: { type: "string", default: "axe,sr,screenshot" },
      tabs: { type: "string", default: "10" },
      out: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(`Usage: bun collect.ts <url> [options]

Collects baseline accessibility evidence from a page. The screen reader
driver must already be running.

Arguments:
  url                     Page to collect evidence from

Options:
  --port <port>           Driver HTTP port (default: ${DEFAULT_PORT})
  --cdp-port <port>       CDP port for agent-browser (default: ${DEFAULT_CDP_PORT})
  --tools <tools>         Comma-separated: axe,sr,screenshot (default: all three)
  --tabs <n>              Number of Tab presses for keyboard nav (default: 10)
  --out <dir>             Write evidence.json + artifacts/* to dir instead of
                          printing full evidence JSON to stdout. Only the
                          evidence.json path is printed on stdout. Used by the
                          LangGraph runner.
  --help                  Show this help

Output:
  Without --out: JSON to stdout with: html, snapshot, axe results, sr transcripts, screenshot.
  With --out <dir>: writes <dir>/evidence.json (thin manifest with relative
    artifact paths, inline SR transcripts, and a needsAuth heuristic) plus
    <dir>/artifacts/{html.html,snapshot.txt,screenshot.png,axe.json}.
  Designed to give the auditor a complete baseline in one command — interpret
  the evidence with AI reasoning rather than running 15+ individual tool calls.`);
    process.exit(0);
  }

  const url = positionals[0];
  const port = parseInt(values.port!, 10);
  const cdpPort = parseInt(values["cdp-port"]!, 10);
  const tools = values.tools!.split(",").filter(Boolean);
  const tabCount = parseInt(values.tabs!, 10);
  const outDir = values.out ? resolve(values.out) : undefined;

  // -------------------------------------------------------------------------
  // Driver helpers — closed over port/cdpPort captured above.
  // -------------------------------------------------------------------------

  async function driverPost(path: string, body?: any): Promise<any> {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  }

  async function driverGet(path: string): Promise<any> {
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    return r.json();
  }

  async function navigate(u: string): Promise<void> {
    const result = await driverPost("/navigate", { url: u });
    if (result?.error) {
      throw new Error(`Navigation failed for ${u}: ${result.error}`);
    }
    await Bun.sleep(2500);
  }

  async function runAxe(): Promise<any> {
    return driverPost("/audit", {});
  }

  async function clearTranscript(): Promise<void> {
    await fetch(`http://127.0.0.1:${port}/transcript`, { method: "DELETE" });
  }

  async function getTranscript(): Promise<any> {
    return driverGet("/transcript");
  }

  async function pressKey(key: string): Promise<any> {
    return driverPost("/press", { key });
  }

  async function perform(command: string): Promise<any> {
    return driverPost("/perform", { command });
  }

  async function enterPage(): Promise<void> {
    const result = await driverPost("/enter");
    if (result?.error) {
      throw new Error(`Failed to enter web content: ${result.error}`);
    }
    await Bun.sleep(1000);
  }

  async function agentBrowser(...args: string[]): Promise<string> {
    const proc = Bun.spawn(["agent-browser", "--cdp", String(cdpPort), ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(
        `agent-browser ${args.join(" ")} failed (exit ${exitCode}): ${stderr.trim()}`,
      );
    }
    return text.trim();
  }

  // -------------------------------------------------------------------------
  // Collection
  // -------------------------------------------------------------------------

  async function collect(): Promise<Evidence> {
    await navigate(url);

    const html = await agentBrowser("eval", "document.documentElement.outerHTML");
    const snapshot = await agentBrowser("snapshot", "-i");

    const evidence: Evidence = { url, html, snapshot };

    if (tools.includes("axe")) {
      const result = await runAxe();
      if (result?.error) {
        throw new Error(`Axe audit failed: ${result.error}`);
      }
      evidence.axe = {
        violations: result?.axe?.violations || [],
        incomplete: result?.axe?.incomplete || [],
        passes: result?.axe?.passes || 0,
        inapplicable: result?.axe?.inapplicable || 0,
      };
    }

    if (tools.includes("sr")) {
      await clearTranscript();
      await enterPage();
      await Bun.sleep(500);
      const onLoad = await getTranscript();

      await clearTranscript();
      for (let i = 0; i < tabCount; i++) {
        await pressKey("Tab");
        await Bun.sleep(800);
      }
      const tabTranscript = await getTranscript();

      await clearTranscript();
      await enterPage();
      await Bun.sleep(300);
      for (let i = 0; i < 5; i++) {
        await perform("FIND_NEXT_LANDMARK");
        await Bun.sleep(800);
      }
      const landmarkTranscript = await getTranscript();

      await clearTranscript();
      await enterPage();
      await Bun.sleep(300);
      for (let i = 0; i < 10; i++) {
        await perform("FIND_NEXT_HEADING");
        await Bun.sleep(800);
      }
      const headingTranscript = await getTranscript();

      await clearTranscript();
      await enterPage();
      await Bun.sleep(300);
      for (let i = 0; i < 5; i++) {
        await perform("FIND_NEXT_LINK");
        await Bun.sleep(800);
      }
      const linkTranscript = await getTranscript();

      evidence.sr = {
        onLoad: onLoad?.entries || [],
        tabSequence: tabTranscript?.entries || [],
        landmarks: landmarkTranscript?.entries || [],
        headings: headingTranscript?.entries || [],
        links: linkTranscript?.entries || [],
      };
    }

    if (tools.includes("screenshot")) {
      evidence.screenshot = await agentBrowser("screenshot");
    }

    return evidence;
  }

  async function writeEvidenceToDir(ev: Evidence, dir: string): Promise<string> {
    const artDir = join(dir, "artifacts");
    await mkdir(artDir, { recursive: true });

    const artifacts: Record<string, string> = {};

    await writeFile(join(artDir, "html.html"), ev.html, "utf8");
    artifacts.html = "artifacts/html.html";

    await writeFile(join(artDir, "snapshot.txt"), ev.snapshot, "utf8");
    artifacts.snapshot = "artifacts/snapshot.txt";

    if (ev.screenshot) {
      const m = /^data:image\/png;base64,(.+)$/.exec(ev.screenshot);
      if (m) {
        await writeFile(join(artDir, "screenshot.png"), Buffer.from(m[1], "base64"));
        artifacts.screenshot = "artifacts/screenshot.png";
      } else {
        // agent-browser returned something other than a png data URL — persist
        // the raw string so the failure is inspectable rather than silently lost.
        await writeFile(join(artDir, "screenshot.txt"), ev.screenshot, "utf8");
        artifacts.screenshot = "artifacts/screenshot.txt";
      }
    }

    if (ev.axe) {
      await writeFile(join(artDir, "axe.json"), JSON.stringify(ev.axe, null, 2) + "\n", "utf8");
      artifacts.axe = "artifacts/axe.json";
    }

    const manifest: EvidenceManifest = {
      url: ev.url,
      artifacts,
      sr: ev.sr,
      signals: { needsAuth: detectNeedsAuth(ev) },
    };

    const manifestPath = join(dir, "evidence.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    return manifestPath;
  }

  try {
    const evidence = await collect();
    if (outDir) {
      const manifestPath = await writeEvidenceToDir(evidence, outDir);
      process.stdout.write(manifestPath + "\n");
    } else {
      console.log(JSON.stringify(evidence, null, 2));
    }
  } catch (err: any) {
    console.error(`Collection error: ${err.message}`);
    if (!outDir) {
      console.log(
        JSON.stringify({
          url,
          html: "",
          snapshot: "",
          error: err.message,
        }),
      );
    }
    process.exit(1);
  }
}
