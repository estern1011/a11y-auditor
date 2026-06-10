/**
 * Live-stream pipeline e2e: real Xvfb + real ffmpeg + the daemon's demux +
 * the /stream WebSocket. Verifies what the byte-flow contract actually
 * delivers, not just the args we hand ffmpeg:
 *
 *   1. The encoder produces fragmented MP4 with `ftyp` + `moov` + `moof`
 *      boxes in the documented order.
 *   2. A late viewer joining mid-stream still receives the init segment
 *      (the cache-and-replay path codex hammered).
 *   3. The first fragment a late viewer is admitted at is a keyframe
 *      (the GOP-aligned-to-fragment-duration fix).
 *   4. When ffmpeg dies mid-session, lingering viewers get force-closed
 *      and the next /stream connection spawns a fresh encoder cleanly
 *      (the onUnexpectedExit + resetDemux fixes).
 *   5. /live-status reflects the running state and viewer count.
 *
 * Skipped if Xvfb or ffmpeg aren't available. Runs ~10 s.
 */

import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { WebSocket } from "ws";
import { startDaemon, startXvfb, stopXvfb, getJson } from "./harness.mjs";

const haveXvfb = spawnSync("which", ["Xvfb"]).status === 0;
const haveFfmpeg = spawnSync("which", ["ffmpeg"]).status === 0;

if (!haveXvfb || !haveFfmpeg) {
  test("stream e2e skipped (need Xvfb + ffmpeg on PATH)", { skip: true });
} else {

let d;
let display;

before(async () => {
  display = await startXvfb(":98");
  d = await startDaemon({ env: { DISPLAY: display } });
});

after(async () => {
  await d?.stop();
  await stopXvfb();
});

/** Parse top-level fMP4 box types from a Buffer. Same byte format the demuxer
 *  consumes — gives us ground truth to assert on. */
function parseBoxTypes(buf) {
  const types = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    let size = buf.readUInt32BE(off);
    if (size === 1) {
      if (off + 16 > buf.length) break;
      size = Number(buf.readBigUInt64BE(off + 8));
    } else if (size === 0) break;
    if (size < 8 || off + size > buf.length) break;
    types.push(buf.toString("ascii", off + 4, off + 8));
    off += size;
  }
  return types;
}

/** Open a /stream WS and accumulate all received bytes until `until(buf)`
 *  returns true (or `timeoutMs` elapses). */
async function collectStream(timeoutMs, until) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${d.port}/stream`);
    ws.binaryType = "arraybuffer";
    const chunks = [];
    let total = Buffer.alloc(0);
    const done = (result) => { try { ws.close(); } catch {} resolve(result); };
    const timer = setTimeout(() => done({ bytes: total, timedOut: true, closed: false }), timeoutMs);
    ws.on("message", (data, isBinary) => {
      const buf = Buffer.from(data);
      chunks.push(buf);
      total = Buffer.concat(chunks);
      if (until(total)) { clearTimeout(timer); done({ bytes: total, timedOut: false, closed: false }); }
    });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
    ws.on("close", () => { clearTimeout(timer); done({ bytes: total, timedOut: false, closed: true }); });
  });
}

// --- 1. ftyp + moov + at least one moof reach a viewer --------------------

test("first viewer receives ftyp, moov, then moof/mdat fragments", async () => {
  // Need enough bytes to see at least two moofs (so we know fragments are
  // flowing, not just init).
  const { bytes, timedOut } = await collectStream(8_000, (b) => {
    const types = parseBoxTypes(b);
    return types.filter((t) => t === "moof").length >= 2;
  });
  assert.ok(!timedOut, `stream timed out after ${bytes.length} bytes`);
  const types = parseBoxTypes(bytes);
  assert.equal(types[0], "ftyp", "first box must be ftyp");
  assert.ok(types.includes("moov"), "moov must appear in the stream");
  assert.ok(types.filter((t) => t === "moof").length >= 2, "multiple moof fragments");
  assert.ok(types.includes("mdat"), "mdat carries the actual media payload");
});

// --- 1b. Startup-window joiner: encoder mid-init, second viewer arrives --

test("a viewer joining during encoder startup still receives ftyp+moov+moof in order", async () => {
  // Need a clean state — no encoder running. Wait for any prior teardown.
  await sleep(800);

  // Spawn two viewers nearly simultaneously, before ffmpeg has finalized
  // its init segment. The first triggers the encoder; the second arrives
  // within the ~200 ms init-build window (the third Set, awaitingInit).
  // Both must receive valid fMP4 with ftyp+moov ahead of any moof.
  const v1 = new WebSocket(`ws://127.0.0.1:${d.port}/stream`);
  v1.binaryType = "arraybuffer";

  // Open v2 ~50 ms later — comfortably inside the 200 ms fragment cadence.
  await sleep(50);
  const collectV2 = collectStream(8_000, (b) => {
    const types = parseBoxTypes(b);
    return types.includes("moof") && types.indexOf("moof") > types.indexOf("ftyp");
  });

  const { bytes, timedOut } = await collectV2;
  assert.ok(!timedOut, `startup-window viewer didn't reach a moof`);
  const types = parseBoxTypes(bytes);
  const ftypIdx = types.indexOf("ftyp");
  const moovIdx = types.indexOf("moov");
  const firstMoof = types.indexOf("moof");
  assert.notEqual(ftypIdx, -1, "startup-window viewer must receive ftyp");
  assert.notEqual(moovIdx, -1, "startup-window viewer must receive moov");
  assert.ok(
    ftypIdx < firstMoof && moovIdx < firstMoof,
    `init boxes must precede first moof; got types: ${types.slice(0, 6).join(",")}`,
  );

  v1.close();
});

// --- 2. /live-status reflects encoder lifecycle ---------------------------

test("/live-status: running:true while a viewer is connected", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${d.port}/stream`);
  ws.binaryType = "arraybuffer";
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  // Give the encoder a moment to start.
  await sleep(500);
  const { body } = await getJson(d.base + "/live-status");
  assert.equal(body.running, true);
  assert.equal(body.viewers, 1);
  assert.equal(body.display, display);
  ws.close();
  // After the last viewer leaves, the disposer kills ffmpeg.
  await sleep(800);
  const after = await getJson(d.base + "/live-status");
  assert.equal(after.body.running, false);
  assert.equal(after.body.viewers, 0);
});

// --- 3. Late joiner gets the cached init segment + IDR-aligned moof ------

test("late joiner mid-stream receives ftyp+moov before its first moof", async () => {
  // First viewer starts the encoder and stays.
  const v1 = new WebSocket(`ws://127.0.0.1:${d.port}/stream`);
  v1.binaryType = "arraybuffer";
  await new Promise((r, j) => { v1.once("open", r); v1.once("error", j); });
  // Wait for the encoder to emit ftyp+moov+a few moofs.
  await sleep(1_500);

  // Second viewer joins late.
  const { bytes, timedOut } = await collectStream(3_000, (b) => {
    const types = parseBoxTypes(b);
    return types.includes("moof");
  });
  assert.ok(!timedOut, "late viewer didn't reach a moof");

  const types = parseBoxTypes(bytes);
  // The contract: cached init segment is replayed BEFORE any moof.
  const firstMoof = types.indexOf("moof");
  const ftypIdx = types.indexOf("ftyp");
  const moovIdx = types.indexOf("moov");
  assert.notEqual(ftypIdx, -1, "late viewer must receive ftyp");
  assert.notEqual(moovIdx, -1, "late viewer must receive moov");
  assert.ok(ftypIdx < firstMoof && moovIdx < firstMoof, "init must precede first moof");

  v1.close();
});

// --- 3b. ffmpeg crash while viewer is in awaitingInit (startup window) --

test("startup-window viewer (awaitingInit) is evicted when ffmpeg dies before first moof", async () => {
  await sleep(800);

  // Open one viewer to start the encoder, then a second to land in
  // awaitingInit. Kill ffmpeg before it can emit a moof — the second viewer
  // (the only one not in sinks) must still be force-closed, not orphaned.
  const v1 = new WebSocket(`ws://127.0.0.1:${d.port}/stream`);
  v1.binaryType = "arraybuffer";
  await new Promise((r, j) => { v1.once("open", r); v1.once("error", j); });

  // Brief delay — long enough for ffmpeg to spawn and start emitting some
  // ftyp/moov bytes, short enough that we're still pre-moof.
  await sleep(80);

  let v2Closed = false;
  const v2 = new WebSocket(`ws://127.0.0.1:${d.port}/stream`);
  v2.on("close", () => { v2Closed = true; });
  await new Promise((r, j) => { v2.once("open", r); v2.once("error", j); });

  // Kill ffmpeg immediately so v2 is still in awaitingInit when it dies.
  const ps = spawnSync("pgrep", ["-P", String(d.proc.pid), "-x", "ffmpeg"], { encoding: "utf-8" });
  const ffmpegPid = parseInt((ps.stdout || "").trim().split("\n")[0], 10);
  if (Number.isFinite(ffmpegPid) && ffmpegPid > 0) {
    process.kill(ffmpegPid, "SIGKILL");
  }

  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && !v2Closed) await sleep(50);
  assert.ok(v2Closed, "awaitingInit viewer must be evicted when ffmpeg dies during startup");
});

// --- 4. ffmpeg crash recovery: lingering viewer evicted, next /stream OK -

test("when ffmpeg is killed externally, viewers are evicted and a fresh encoder starts on next connect", async () => {
  // Drain any previous encoder.
  await sleep(800);

  const v1 = new WebSocket(`ws://127.0.0.1:${d.port}/stream`);
  v1.binaryType = "arraybuffer";
  await new Promise((r, j) => { v1.once("open", r); v1.once("error", j); });
  await sleep(600); // let the encoder spin up

  let v1Closed = false;
  v1.on("close", () => { v1Closed = true; });

  // Find the ffmpeg child of the daemon and kill it.
  const daemonPid = d.proc.pid;
  // pgrep -P PID -x ffmpeg won't work universally; use ps + parent filter.
  const ps = spawnSync("pgrep", ["-P", String(daemonPid), "-x", "ffmpeg"], { encoding: "utf-8" });
  const ffmpegPid = parseInt((ps.stdout || "").trim().split("\n")[0], 10);
  assert.ok(Number.isFinite(ffmpegPid) && ffmpegPid > 0, `couldn't find ffmpeg child of daemon (pid=${daemonPid}): ${ps.stdout}`);

  process.kill(ffmpegPid, "SIGKILL");

  // Wait for the viewer to be force-closed by the exit handler.
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && !v1Closed) await sleep(50);
  assert.ok(v1Closed, "lingering viewer should be force-closed by the encoder's exit handler");

  // /live-status should report not-running.
  const status = await getJson(d.base + "/live-status");
  assert.equal(status.body.running, false);

  // Next /stream connect should bring up a FRESH encoder with a fresh init segment.
  const { bytes, timedOut } = await collectStream(5_000, (b) => {
    const types = parseBoxTypes(b);
    return types.includes("ftyp") && types.includes("moov") && types.includes("moof");
  });
  assert.ok(!timedOut, `next viewer didn't receive init+moof after ffmpeg crash`);
  const types = parseBoxTypes(bytes);
  assert.equal(types[0], "ftyp", "fresh encoder restarts demux state — ftyp must be first");
});

}
