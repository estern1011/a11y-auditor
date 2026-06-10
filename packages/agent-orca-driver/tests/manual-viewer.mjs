/**
 * Manual verification: render the live-view viewer in a real Chromium and
 * capture screenshots of each state the operator interacts with. Run via
 * `node tests/manual-viewer.mjs`. Outputs go to `tmp/viewer-manual/`.
 *
 * Stages:
 *   1. Initial render (everything ON, dot idle)
 *   2. Focus rectangle visible (simulated AT-SPI bbox)
 *   3. Overlay toggled OFF (rectangle hidden, page styling unobstructed)
 *   4. Activity dot pulsing (transcript event)
 *   5. Keyboard toggle OFF (state visible in side panel)
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { viewerHtml } from "../dist/src/live/viewer.js";

const OUT = "tmp/viewer-manual";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", () => {});
page.on("console", () => {});

await page.setContent(viewerHtml(1280, 1024), { waitUntil: "domcontentloaded" });

async function shot(name, caption) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  → ${path}  (${caption})`);
}

// Stage a fake video frame underneath the focus rectangle so it has
// something to overlay on (otherwise the stage is just black).
await page.evaluate(() => {
  const v = document.getElementById("v");
  v.style.background = "#1f2937";
  v.style.width = "1240px";
  v.style.height = "900px";
  // Simulate a webpage rendered in the captured frame.
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:absolute;inset:0;color:#9ca3af;font:14px/1.4 system-ui;padding:24px;pointer-events:none;";
  overlay.innerHTML = "<h2 style='color:#e5e7eb'>example.com — captured video frame</h2>" +
    "<p>(this stand-in stands in for the real Xvfb framebuffer, which would be the Chromium window being driven by Orca)</p>" +
    "<button style='padding:8px 16px;background:#3b82f6;color:white;border:none;border-radius:4px;margin-top:200px;margin-left:200px;outline:2px solid #fbbf24;outline-offset:2px'>Sign in</button>";
  v.parentElement.appendChild(overlay);
});

console.log("Capturing screenshots:");
await shot("01-initial", "default state: keyboard ON, overlay ON, dot idle (grey)");

// Stage 2: simulate a focus event on the "Sign in" button.
await page.evaluate(() => {
  const btn = document.querySelector("button");
  const r = btn.getBoundingClientRect();
  const wrap = document.getElementById("wrap");
  const wrapRect = wrap.getBoundingClientRect();
  const v = document.getElementById("v");
  // Scale to AT-SPI screen coordinates (FB_W=1280, video.clientWidth=current)
  const sx = 1280 / v.clientWidth, sy = 1024 / v.clientHeight;
  const bbox = {
    x: (r.left - wrapRect.left) * sx,
    y: (r.top - wrapRect.top) * sy,
    w: r.width * sx,
    h: r.height * sy,
  };
  // Re-create what showFocus does (it's in closure scope, so reach in).
  const f = document.getElementById("focus");
  f.style.display = "block";
  f.style.left = (bbox.x * v.clientWidth / 1280) + "px";
  f.style.top = (bbox.y * v.clientHeight / 1024) + "px";
  f.style.width = (bbox.w * v.clientWidth / 1280) + "px";
  f.style.height = (bbox.h * v.clientHeight / 1024) + "px";
  f.querySelector(".label").textContent = "push button: Sign in";
});
await page.waitForTimeout(200);
await shot("02-focus-visible", "AT-SPI focus rectangle + role/name label over the simulated frame");

// Stage 3: toggle the overlay OFF.
await page.click("#overlay");
await page.waitForTimeout(200);
await shot("03-overlay-off", "overlay OFF — page's own focus styling (the yellow outline) is visible without our overlay competing");

// Bring it back on for the next shots.
await page.click("#overlay");
await page.waitForTimeout(200);

// Stage 4: trigger the activity-dot pulse.
await page.evaluate(() => document.getElementById("dot").classList.add("pulse"));
await page.waitForTimeout(300);
await shot("04-activity-pulse", "activity dot pulsing green (would be triggered by a /events transcript message)");

// Stage 5: keyboard toggle OFF.
await page.evaluate(() => document.getElementById("dot").classList.remove("pulse"));
await page.click("#kbd");
await page.waitForTimeout(200);
await shot("05-keyboard-off", "keyboard forwarding OFF — Tab now goes to the operator's browser instead of Orca");

await browser.close();
console.log("\nDone. " + OUT + "/ contains 5 PNGs.");
