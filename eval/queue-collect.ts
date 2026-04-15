#!/usr/bin/env bun
/**
 * On-sprite evidence collector for evals — navigates to a URL, runs tools,
 * returns raw data with answer redaction for blind evaluation.
 *
 * For general-purpose evidence collection (real audits), use collect.ts instead.
 * This file adds eval-specific behavior: page title redaction to prevent bias
 * when evaluating against W3C ACT test cases.
 *
 * Runs on the sprite (not locally). Called by agents via sprite exec:
 *   sprite exec -s SPRITE -- bash -c '... && bun eval/queue-collect.ts URL TOOLS'
 *
 * Arguments:
 *   URL    — page to test
 *   TOOLS  — comma-separated tool list: axe,sr,screenshot
 *
 * Outputs JSON to stdout with collected evidence. NO verdict — that's the agent's job.
 * Page titles are redacted to prevent answer leakage.
 */

const DRIVER = "http://127.0.0.1:7484";

const url = process.argv[2];
const tools = (process.argv[3] || "").split(",").filter(Boolean);

if (!url) {
  console.error("Usage: bun eval/queue-collect.ts URL TOOLS");
  process.exit(1);
}

// --- Driver helpers ---

async function driverPost(path: string, body?: any): Promise<any> {
  const r = await fetch(`${DRIVER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

async function navigate(u: string): Promise<void> {
  await driverPost("/navigate", { url: u });
  await Bun.sleep(2500);
}

async function runAxe(): Promise<any> {
  const r = await fetch(`${DRIVER}/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return r.json();
}

async function clearTranscript(): Promise<void> {
  await fetch(`${DRIVER}/transcript`, { method: "DELETE" });
}

async function getTranscript(): Promise<any> {
  const r = await fetch(`${DRIVER}/transcript`);
  return r.json();
}

async function pressKey(key: string): Promise<any> {
  return driverPost("/press", { key });
}

async function perform(command: string): Promise<any> {
  return driverPost("/perform", { command });
}

async function enterPage(): Promise<void> {
  const proc = Bun.spawn(["bun", "drivers/orca/driver.ts", "enter"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  await Bun.sleep(1000);
}

async function agentBrowser(...args: string[]): Promise<string> {
  const proc = Bun.spawn(["agent-browser", "--cdp", "9223", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.trim();
}

// --- Answer redaction ---

const ANSWER_PATTERN = /\b(Passed|Failed|Inapplicable)\s+(Example|Test)\s*\d*/gi;
const ANSWER_PATTERN_SHORT = /\b(Pass|Fail)\w*\s+(Example|Test)\s*\d*/gi;

function redactAnswers(html: string): string {
  // Redact "Passed/Failed/Inapplicable Example N" from:
  // 1. <title> tags
  // 2. <h1>-<h6> tags
  // 3. Any visible text that matches the pattern
  // This prevents answer leakage from page content.
  return html
    .replace(ANSWER_PATTERN, "Test Page")
    .replace(ANSWER_PATTERN_SHORT, "Test Page");
}

// --- Main collection ---

interface Evidence {
  url: string;
  html: string;        // full page HTML with title redacted
  snapshot: string;     // agent-browser accessibility snapshot
  axe?: {
    violations: any[];
    incomplete: any[];
    passes: number;
    inapplicable: number;
  };
  sr?: {
    onLoad: any[];      // what was announced on page load
    tabSequence: any[];  // transcript after tabbing through page
    landmarks: any[];    // FIND_NEXT_LANDMARK results
    headings: any[];     // FIND_NEXT_HEADING results
    links: any[];        // FIND_NEXT_LINK results
  };
}

async function collect(): Promise<Evidence> {
  // Navigate
  await navigate(url);

  // Get HTML (redacted) and snapshot
  const rawHtml = await agentBrowser("eval", "document.documentElement.outerHTML");
  const html = redactAnswers(rawHtml);
  const snapshot = await agentBrowser("snapshot", "-i");

  const evidence: Evidence = { url, html, snapshot };

  // Run axe if requested
  if (tools.includes("axe")) {
    const result = await runAxe();
    evidence.axe = {
      violations: result?.axe?.violations || [],
      incomplete: result?.axe?.incomplete || [],
      passes: result?.axe?.passes || 0,
      inapplicable: result?.axe?.inapplicable || 0,
    };
  }

  // Run SR if requested
  if (tools.includes("sr")) {
    // Capture what's announced on page load
    await clearTranscript();
    await enterPage();
    await Bun.sleep(500);
    const onLoad = await getTranscript();

    // Tab through page (6 tabs to detect traps and focus order)
    await clearTranscript();
    for (let i = 0; i < 6; i++) {
      await pressKey("Tab");
      await Bun.sleep(800);
    }
    const tabTranscript = await getTranscript();

    // Find landmarks
    await clearTranscript();
    await enterPage();
    await Bun.sleep(300);
    await perform("FIND_NEXT_LANDMARK");
    await Bun.sleep(800);
    await perform("FIND_NEXT_LANDMARK");
    await Bun.sleep(800);
    const landmarkTranscript = await getTranscript();

    // Find headings
    await clearTranscript();
    await enterPage();
    await Bun.sleep(300);
    await perform("FIND_NEXT_HEADING");
    await Bun.sleep(800);
    const headingTranscript = await getTranscript();

    // Find links
    await clearTranscript();
    await enterPage();
    await Bun.sleep(300);
    await perform("FIND_NEXT_LINK");
    await Bun.sleep(800);
    await perform("FIND_NEXT_LINK");
    await Bun.sleep(800);
    const linkTranscript = await getTranscript();

    evidence.sr = {
      onLoad: onLoad?.entries || [],
      tabSequence: tabTranscript?.entries || [],
      landmarks: landmarkTranscript?.entries || [],
      headings: headingTranscript?.entries || [],
      links: linkTranscript?.entries || [],
    };
  }

  return evidence;
}

// Run and output — always exit 0 with parseable JSON.
// Callers check for the `error` field to detect failures.
try {
  const evidence = await collect();
  console.log(JSON.stringify(evidence));
} catch (err: any) {
  console.error(`Collection error: ${err.message}`);
  console.log(JSON.stringify({
    url,
    html: "",
    snapshot: "",
    error: err.message,
  }));
}
