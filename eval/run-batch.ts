#!/usr/bin/env bun
/**
 * Batch eval runner — runs entirely on the sprite.
 * Usage: bun eval/run-batch.ts < cases.json > results.json
 *
 * Reads test cases from stdin, hits the local Orca driver HTTP API,
 * collects tool outputs, and writes results JSON to stdout.
 */

const DRIVER = "http://127.0.0.1:7484";
const CDP_PORT = 9223;

interface TestCase {
  ruleId: string;
  ruleName: string;
  wcagCriteria: string[];
  url: string;
  expected: string;
  description: string;
  criteria: string[];
  tools: string[];
}

interface Result {
  ruleId: string;
  criterion: string;
  url: string;
  expected: string;
  actual: string;
  correct: boolean;
  toolsUsed: string[];
  remarks: string;
}

function normalize(expected: string): string {
  if (expected === "passed") return "pass";
  if (expected === "failed") return "fail";
  return expected;
}

async function driverGet(path: string): Promise<any> {
  const r = await fetch(`${DRIVER}${path}`);
  return r.json();
}

async function driverPost(path: string, body?: any): Promise<any> {
  const r = await fetch(`${DRIVER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

async function driverDelete(path: string): Promise<void> {
  await fetch(`${DRIVER}${path}`, { method: "DELETE" });
}

async function navigate(url: string): Promise<void> {
  await driverPost("/navigate", { url });
  await Bun.sleep(2000);
}

async function getPageHtml(): Promise<string> {
  try {
    const proc = Bun.spawn(["agent-browser", "--cdp", String(CDP_PORT), "eval", 'document.documentElement.outerHTML'], {
      stdout: "pipe", stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return text;
  } catch {
    return "";
  }
}

async function getSnapshot(): Promise<string> {
  try {
    const proc = Bun.spawn(["agent-browser", "--cdp", String(CDP_PORT), "snapshot", "-i"], {
      stdout: "pipe", stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return text;
  } catch {
    return "";
  }
}

async function runAxe(): Promise<any> {
  try {
    const r = await fetch(`${DRIVER}/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return r.json();
  } catch {
    return { axe: { violations: [], incomplete: [], passes: 0 } };
  }
}

async function pressKey(key: string): Promise<any> {
  return driverPost("/press", { key });
}

async function perform(command: string): Promise<any> {
  return driverPost("/perform", { command });
}

async function getTranscript(): Promise<any> {
  return driverGet("/transcript");
}

async function clearTranscript(): Promise<void> {
  await driverDelete("/transcript");
}

async function enterPage(): Promise<void> {
  // Focus the page content
  const proc = Bun.spawn(["bun", "drivers/orca/driver.ts", "enter"], {
    stdout: "pipe", stderr: "pipe",
  });
  await proc.exited;
  await Bun.sleep(1000);
}

// Rule-specific inapplicable checks
function checkInapplicable(html: string, ruleId: string): boolean {
  const lower = html.toLowerCase();
  switch (ruleId) {
    case "0va7u6": // Images of text — need <img> with src
      return !/<img\s/i.test(html);
    case "80f0bf": // Audio auto-play — need <audio> or <video>
      return !/<audio[\s>]/i.test(html) && !/<video[\s>]/i.test(html);
    case "80af7b": // No keyboard trap — need focusable elements
      return !/<a[\s>]/i.test(html) && !/<button[\s>]/i.test(html) &&
             !/<input[\s>]/i.test(html) && !/<select[\s>]/i.test(html) &&
             !/<textarea[\s>]/i.test(html) && !/tabindex/i.test(html);
    case "36b590": // Error identification — need form with inputs
      return !/<input[\s>]/i.test(html) && !/<select[\s>]/i.test(html) &&
             !/<textarea[\s>]/i.test(html);
    case "ffbc54": // Char key shortcuts — need keyboard event listeners
      return !/accesskey/i.test(html) && !/onkey/i.test(html) &&
             !/addEventListener/i.test(html) && !/shortcut/i.test(lower);
    case "oj04fd": // Focus visible — need focusable elements
      return !/<a[\s>]/i.test(html) && !/<button[\s>]/i.test(html) &&
             !/<input[\s>]/i.test(html) && !/tabindex/i.test(html);
    case "afw4f7": // Text contrast — need visible text
      return !/<p[\s>]/i.test(html) && !/<span[\s>]/i.test(html) &&
             !/<div[\s>]/i.test(html) && !/<h[1-6][\s>]/i.test(html);
    case "b49b2e": // Heading descriptive — need headings
      return !/<h[1-6][\s>]/i.test(html);
    case "5effbb": // Link purpose — need links
      return !/<a[\s>]/i.test(html);
    case "c4a8a4": // Page title — always applicable if <title> exists
      return !/<title[\s>]/i.test(html);
    case "cf77f2": // Bypass blocks — need repeated content blocks
      // Hard to detect automatically; don't auto-inapplicable
      return false;
    case "9bd38c": // Sensory characteristics — need instructions
      return false; // Always check manually
    case "b33eff": // Orientation — need CSS
      return false; // Always check
    default:
      return false;
  }
}

async function evaluateCase(tc: TestCase): Promise<Result> {
  const criterion = tc.criteria[0] || tc.wcagCriteria[0];
  const expected = normalize(tc.expected);
  const toolsUsed: string[] = [];

  // Navigate
  await navigate(tc.url);

  // Get page HTML
  const html = await getPageHtml();

  // Check inapplicable
  if (checkInapplicable(html, tc.ruleId)) {
    return {
      ruleId: tc.ruleId, criterion, url: tc.url,
      expected, actual: "inapplicable", correct: expected === "inapplicable",
      toolsUsed: ["screenshot"], remarks: "Page lacks relevant element type for this rule.",
    };
  }

  let violations: string[] = [];
  let evidence: string[] = [];

  // Run axe if needed
  if (tc.tools.includes("axe")) {
    toolsUsed.push("axe");
    const axeResult = await runAxe();
    const axe = axeResult?.axe || axeResult;
    if (axe?.violations?.length > 0) {
      for (const v of axe.violations) {
        // Only count WCAG violations, not best-practice
        if (v.wcag?.some((w: string) => w.startsWith("wcag"))) {
          violations.push(`axe:${v.id} (${v.impact}): ${v.help}`);
        }
      }
    }
    if (axe?.incomplete?.length > 0) {
      for (const inc of axe.incomplete) {
        if (inc.wcag?.some((w: string) => w.startsWith("wcag"))) {
          evidence.push(`axe-incomplete:${inc.id}: ${inc.help}`);
        }
      }
    }
    if (violations.length === 0 && evidence.length === 0) {
      evidence.push("axe: no WCAG violations");
    }
  }

  // Run SR if needed
  if (tc.tools.includes("sr")) {
    toolsUsed.push("sr");
    await clearTranscript();
    await enterPage();

    // Criterion-specific SR testing
    switch (tc.ruleId) {
      case "80af7b": { // Keyboard trap
        const positions: string[] = [];
        for (let i = 0; i < 6; i++) {
          await pressKey("Tab");
          await Bun.sleep(800);
        }
        const transcript = await getTranscript();
        const entries = transcript?.entries || [];
        const names = entries.map((e: any) => e.name).filter(Boolean);
        // Check for cycling pattern
        if (names.length >= 4) {
          const last4 = names.slice(-4);
          const unique = new Set(last4);
          if (unique.size <= 2) {
            violations.push(`sr: keyboard trap detected — focus cycles between ${[...unique].join(" and ")}`);
          } else {
            evidence.push(`sr: focus moves freely through ${unique.size} elements`);
          }
        } else {
          evidence.push(`sr: ${names.length} elements reached via Tab`);
        }
        break;
      }
      case "36b590": { // Error identification
        await pressKey("Tab");
        await Bun.sleep(800);
        const transcript = await getTranscript();
        const entries = transcript?.entries || [];
        const spoken = entries.map((e: any) => e.spoken || "").join(" ");
        if (/invalid|error|must|required|cannot|incorrect/i.test(spoken)) {
          evidence.push(`sr: error message announced: "${spoken.substring(0, 200)}"`);
        } else {
          // Check if there should be an error announced
          if (/aria-describedby|aria-errormessage/i.test(html)) {
            evidence.push(`sr: aria association exists, announced: "${spoken.substring(0, 200)}"`);
          } else if (/error|invalid/i.test(html) && !/aria-describedby/i.test(html)) {
            violations.push(`sr: error text in DOM but not associated with input field`);
          } else {
            evidence.push(`sr: form field announced: "${spoken.substring(0, 200)}"`);
          }
        }
        break;
      }
      case "80f0bf": { // Audio control
        const snapshot = await getSnapshot();
        if (/autoplay/i.test(html) && !/<audio[^>]*controls/i.test(html) && !/<video[^>]*controls/i.test(html)) {
          violations.push("sr: audio/video has autoplay without controls");
        } else {
          evidence.push("sr: audio/video has controls or does not autoplay");
        }
        break;
      }
      case "cf77f2": { // Bypass blocks
        await perform("FIND_NEXT_LANDMARK");
        await Bun.sleep(800);
        const transcript = await getTranscript();
        const spoken = (transcript?.entries || []).map((e: any) => e.spoken || "").join(" ");
        if (/navigation|main|banner|complementary/i.test(spoken) && !/complementary/i.test(spoken.replace(/navigation|main|banner/g, ""))) {
          // Has meaningful landmark (nav, main, banner) not just complementary
          if (/navigation|main|banner/i.test(spoken)) {
            evidence.push(`sr: found landmarks: ${spoken.substring(0, 200)}`);
          } else {
            violations.push(`sr: only complementary landmark, no bypass mechanism`);
          }
        } else if (/skip|bypass|jump/i.test(html)) {
          evidence.push("sr: skip link found in HTML");
        } else if (/<nav[\s>]/i.test(html) || /role="navigation"/i.test(html) || /<main[\s>]/i.test(html) || /role="main"/i.test(html)) {
          evidence.push("sr: navigation/main landmark in HTML");
        } else {
          violations.push(`sr: no bypass mechanism found. Spoken: ${spoken.substring(0, 150)}`);
        }
        break;
      }
      case "c4a8a4": { // Page title descriptive
        const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
        const title = titleMatch?.[1] || "";
        const bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 500);
        evidence.push(`sr: title="${title}", body preview="${bodyText.substring(0, 200)}"`);
        // Check obvious mismatches
        if (!title || title.trim().length === 0) {
          violations.push("sr: page title is empty");
        }
        break;
      }
      case "b49b2e": { // Heading descriptive
        await perform("FIND_NEXT_HEADING");
        await Bun.sleep(800);
        const transcript = await getTranscript();
        const spoken = (transcript?.entries || []).map((e: any) => e.spoken || "").join(" ");
        const bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        evidence.push(`sr: heading announced="${spoken.substring(0, 200)}", body="${bodyText.substring(0, 200)}"`);
        break;
      }
      case "5effbb": { // Link purpose
        await perform("FIND_NEXT_LINK");
        await Bun.sleep(800);
        const transcript = await getTranscript();
        const entries = transcript?.entries || [];
        const linkName = entries.find((e: any) => e.role === "link")?.name || "";
        evidence.push(`sr: link text="${linkName}"`);
        if (/^(more|click here|read more|here|link|learn more)$/i.test(linkName.trim())) {
          violations.push(`sr: ambiguous link text "${linkName}"`);
        }
        break;
      }
      case "ffbc54": { // Character key shortcuts
        const hasShortcut = /shortcut|accesskey|onkey/i.test(html);
        const hasRemap = /remap|checkbox|toggle|modifier|disable|turn off/i.test(html);
        if (hasShortcut && !hasRemap) {
          violations.push("sr: keyboard shortcut found with no remap/disable mechanism");
        } else if (hasShortcut && hasRemap) {
          evidence.push("sr: keyboard shortcut has remap/disable mechanism");
        } else {
          evidence.push("sr: no character key shortcuts detected");
        }
        break;
      }
      case "oj04fd": { // Focus visible
        await pressKey("Tab");
        await Bun.sleep(800);
        const transcript = await getTranscript();
        evidence.push(`sr: focus moved, ${(transcript?.entries || []).length} entries`);
        // Check CSS for outline:none
        if (/outline:\s*none|outline:\s*0[^.]/i.test(html)) {
          violations.push("sr: CSS outline:none detected — likely no visible focus indicator");
        } else {
          evidence.push("sr: no outline:none in inline styles");
        }
        break;
      }
      default: {
        await pressKey("Tab");
        await Bun.sleep(800);
        const transcript = await getTranscript();
        evidence.push(`sr: ${(transcript?.entries || []).length} transcript entries`);
      }
    }
  }

  // Run screenshot checks (DOM-based, no actual screenshots)
  if (tc.tools.includes("screenshot")) {
    toolsUsed.push("screenshot");

    switch (tc.ruleId) {
      case "afw4f7": // Contrast — axe handles this
        evidence.push("screenshot: contrast checked via axe");
        break;
      case "0va7u6": { // Images of text
        const hasImg = /<img\s/i.test(html);
        if (hasImg) {
          // Check if the image likely contains text
          const imgSrc = html.match(/src="([^"]+)"/i)?.[1] || "";
          const altText = html.match(/alt="([^"]+)"/i)?.[1] || "";
          if (/text|word|paragraph|document|letter|font/i.test(imgSrc)) {
            violations.push(`screenshot: image src suggests text content: ${imgSrc}`);
          } else {
            evidence.push(`screenshot: image src="${imgSrc}", alt="${altText}"`);
          }
        }
        break;
      }
      case "9bd38c": { // Sensory characteristics
        const bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        const hasSensoryOnly = /\b(on the right|on the left|above|below|the round|the square|the red|the green|the blue|see the|look at)\b/i.test(bodyText);
        const hasNonSensory = /\b(labelled|labeled|named|titled|called|button|link|heading|menu|form)\b/i.test(bodyText);
        if (hasSensoryOnly && !hasNonSensory) {
          violations.push(`screenshot: instructions rely solely on sensory characteristics`);
        } else if (hasSensoryOnly && hasNonSensory) {
          evidence.push("screenshot: sensory reference with non-sensory alternative");
        } else {
          evidence.push("screenshot: no sensory-only references found");
        }
        break;
      }
      case "b33eff": { // Orientation
        const orientMatch = html.match(/@media\s*\(\s*orientation\s*:\s*portrait\s*\)\s*\{[^}]*transform\s*:\s*([^;]+)/i);
        if (orientMatch) {
          const transform = orientMatch[1].trim();
          if (/rotate\s*\(\s*1turn\s*\)|rotate\s*\(\s*360deg\s*\)|rotate\s*\(\s*0/i.test(transform)) {
            evidence.push(`screenshot: orientation CSS has no-op transform: ${transform}`);
          } else {
            violations.push(`screenshot: orientation restricted via CSS transform: ${transform}`);
          }
        } else {
          evidence.push("screenshot: no orientation-locking CSS found");
        }
        break;
      }
      case "oj04fd": // Focus visible — handled in sr section
        break;
      default:
        evidence.push("screenshot: DOM inspected");
    }
  }

  // Determine verdict
  let actual: string;
  if (violations.length > 0) {
    actual = "fail";
  } else {
    actual = "pass";
  }

  const remarks = [...violations, ...evidence].join("; ").substring(0, 500);

  return {
    ruleId: tc.ruleId, criterion, url: tc.url,
    expected, actual, correct: expected === actual,
    toolsUsed, remarks,
  };
}

async function main() {
  const input = await Bun.stdin.text();
  const cases: TestCase[] = JSON.parse(input);
  const results: Result[] = [];

  console.error(`Processing ${cases.length} test cases...`);

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    console.error(`[${i + 1}/${cases.length}] ${tc.ruleId} ${tc.description}`);
    try {
      const result = await evaluateCase(tc);
      results.push(result);
    } catch (err: any) {
      console.error(`  ERROR: ${err.message}`);
      results.push({
        ruleId: tc.ruleId,
        criterion: tc.criteria[0] || tc.wcagCriteria[0],
        url: tc.url,
        expected: normalize(tc.expected),
        actual: "not_evaluated",
        correct: false,
        toolsUsed: [],
        remarks: `Error: ${err.message}`,
      });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
