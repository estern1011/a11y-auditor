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
 *
 * Outputs JSON to stdout with collected evidence.
 * The driver must already be running (bun {sr-driver} start <url>).
 */

import { parseArgs } from "util";
import { DEFAULT_PORT as VO_PORT, DEFAULT_CDP_PORT as VO_CDP } from "./drivers/voiceover/core.ts";
import { DEFAULT_PORT as ORCA_PORT, DEFAULT_CDP_PORT as ORCA_CDP } from "./drivers/orca/core.ts";

// ---------------------------------------------------------------------------
// Platform defaults
// ---------------------------------------------------------------------------

const IS_MAC = process.platform === "darwin";
const DEFAULT_PORT = IS_MAC ? VO_PORT : ORCA_PORT;
const DEFAULT_CDP_PORT = IS_MAC ? VO_CDP : ORCA_CDP;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string", default: String(DEFAULT_PORT) },
    "cdp-port": { type: "string", default: String(DEFAULT_CDP_PORT) },
    tools: { type: "string", default: "axe,sr,screenshot" },
    tabs: { type: "string", default: "10" },
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
  --help                  Show this help

Output:
  JSON to stdout with: html, snapshot, axe results, sr transcripts, screenshot.
  Designed to give the auditor a complete baseline in one command — interpret
  the evidence with AI reasoning rather than running 15+ individual tool calls.`);
  process.exit(0);
}

const url = positionals[0];
const port = parseInt(values.port!, 10);
const cdpPort = parseInt(values["cdp-port"]!, 10);
const tools = values.tools!.split(",").filter(Boolean);
const tabCount = parseInt(values.tabs!, 10);

// ---------------------------------------------------------------------------
// Driver helpers
// ---------------------------------------------------------------------------

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
  await driverPost("/enter");
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
    throw new Error(`agent-browser ${args.join(" ")} failed (exit ${exitCode}): ${stderr.trim()}`);
  }
  return text.trim();
}

// ---------------------------------------------------------------------------
// Evidence shape
// ---------------------------------------------------------------------------

interface Evidence {
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

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

async function collect(): Promise<Evidence> {
  // Navigate
  await navigate(url);

  // Get HTML and accessibility snapshot
  const html = await agentBrowser("eval", "document.documentElement.outerHTML");
  const snapshot = await agentBrowser("snapshot", "-i");

  const evidence: Evidence = { url, html, snapshot };

  // Axe
  if (tools.includes("axe")) {
    const result = await runAxe();
    evidence.axe = {
      violations: result?.axe?.violations || [],
      incomplete: result?.axe?.incomplete || [],
      passes: result?.axe?.passes || 0,
      inapplicable: result?.axe?.inapplicable || 0,
    };
  }

  // Screen reader
  if (tools.includes("sr")) {
    // What's announced on page load
    await clearTranscript();
    await enterPage();
    await Bun.sleep(500);
    const onLoad = await getTranscript();

    // Tab through page
    await clearTranscript();
    for (let i = 0; i < tabCount; i++) {
      await pressKey("Tab");
      await Bun.sleep(800);
    }
    const tabTranscript = await getTranscript();

    // Landmarks
    await clearTranscript();
    await enterPage();
    await Bun.sleep(300);
    for (let i = 0; i < 5; i++) {
      await perform("FIND_NEXT_LANDMARK");
      await Bun.sleep(800);
    }
    const landmarkTranscript = await getTranscript();

    // Headings
    await clearTranscript();
    await enterPage();
    await Bun.sleep(300);
    for (let i = 0; i < 10; i++) {
      await perform("FIND_NEXT_HEADING");
      await Bun.sleep(800);
    }
    const headingTranscript = await getTranscript();

    // Links
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

  // Screenshot
  if (tools.includes("screenshot")) {
    evidence.screenshot = await agentBrowser("screenshot");
  }

  return evidence;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

try {
  const evidence = await collect();
  console.log(JSON.stringify(evidence, null, 2));
} catch (err: any) {
  console.error(`Collection error: ${err.message}`);
  console.log(JSON.stringify({
    url,
    html: "",
    snapshot: "",
    error: err.message,
  }));
  process.exit(1);
}
