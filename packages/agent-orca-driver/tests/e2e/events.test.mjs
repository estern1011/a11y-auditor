/**
 * /events WS contract test. Verifies that:
 *   - Subscribing succeeds.
 *   - Driver actions emit `transcript` events on the WS (the speech.ts +
 *     core.ts paths both flow through liveEvents.emitTranscript).
 *   - Driver actions with a bbox emit `focus` events with the bbox attached
 *     (the AT-SPI bbox payload the viewer's overlay scales).
 *   - Both event types arrive as JSON with the documented `type` discriminator.
 */

import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";
import { startDaemon } from "./harness.mjs";

let d;
before(async () => { d = await startDaemon(); });
after(async () => { await d?.stop(); });

async function openEvents() {
  const ws = new WebSocket(`ws://127.0.0.1:${d.port}/events`);
  const events = [];
  ws.on("message", (data) => {
    try { events.push(JSON.parse(data.toString())); }
    catch { /* ignore malformed */ }
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
    setTimeout(() => reject(new Error("ws timeout")), 2_000);
  });
  return { ws, events };
}

test("driver actions emit transcript events on /events", async () => {
  const { ws, events } = await openEvents();
  // Give the WS a tick to settle, then trigger an action.
  await sleep(50);
  await fetch(d.base + "/next", { method: "POST" });
  // Wait briefly for the event to arrive.
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline && !events.some((e) => e.type === "transcript")) {
    await sleep(20);
  }
  const transcript = events.find((e) => e.type === "transcript");
  assert.ok(transcript, `no transcript event received (got: ${JSON.stringify(events)})`);
  assert.equal(transcript.source, "orca");
  assert.equal(typeof transcript.text, "string");
  assert.equal(typeof transcript.t, "number");
  ws.close();
});

test("driver actions with a bbox emit focus events with the bbox attached", async () => {
  const { ws, events } = await openEvents();
  await sleep(50);
  // The fake driver's next() includes a bbox.
  await fetch(d.base + "/next", { method: "POST" });
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline && !events.some((e) => e.type === "focus")) {
    await sleep(20);
  }
  const focus = events.find((e) => e.type === "focus");
  assert.ok(focus, `no focus event received (got: ${JSON.stringify(events)})`);
  assert.equal(typeof focus.t, "number");
  assert.ok(focus.bbox);
  assert.equal(typeof focus.bbox.x, "number");
  assert.equal(typeof focus.bbox.y, "number");
  assert.equal(typeof focus.bbox.w, "number");
  assert.equal(typeof focus.bbox.h, "number");
  ws.close();
});

test("two viewers both receive the same event", async () => {
  const a = await openEvents();
  const b = await openEvents();
  await sleep(50);
  await fetch(d.base + "/enter", { method: "POST" });
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline &&
         !(a.events.some((e) => e.type === "transcript") && b.events.some((e) => e.type === "transcript"))) {
    await sleep(20);
  }
  assert.ok(a.events.some((e) => e.type === "transcript"));
  assert.ok(b.events.some((e) => e.type === "transcript"));
  a.ws.close();
  b.ws.close();
});

test("disconnecting one viewer doesn't stop events for the other", async () => {
  const a = await openEvents();
  const b = await openEvents();
  await sleep(50);
  a.ws.close();
  await sleep(50);
  await fetch(d.base + "/next", { method: "POST" });
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline && !b.events.some((e) => e.type === "transcript")) {
    await sleep(20);
  }
  assert.ok(b.events.some((e) => e.type === "transcript"), "remaining viewer still gets events");
  b.ws.close();
});
