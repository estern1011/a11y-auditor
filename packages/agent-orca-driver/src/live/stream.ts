/**
 * Live video stream for `/live`: the Xvfb framebuffer encoded as h264 in a
 * fragmented MP4, pushed as binary chunks over a WebSocket and played in the
 * browser via Media Source Extensions.
 *
 * One ffmpeg process is shared by all viewers (ref-counted): it starts when
 * the first `/stream` client connects and is torn down when the last one
 * disconnects, so there's no encoder running while nobody's watching.
 *
 * To stay decodable for viewers that join mid-stream, the ffmpeg output is
 * demuxed into top-level MP4 boxes: the `ftyp`+`moov` init segment is cached
 * and replayed to late joiners, and a freshly-joined viewer only starts
 * receiving live boxes from the next `moof` boundary (never mid-fragment).
 *
 * Why MSE-over-WebSocket (not WebRTC/VNC): it rides the existing HTTPS+WS
 * plumbing that Codespaces' port-forward proxy already tunnels — see the plan
 * §6. Why x11grab (not CDP screencast): it captures the whole X framebuffer,
 * so native popups, the system cursor, and Orca's own focus indicator are all
 * visible, not just Chromium's compositor.
 */

import { spawn, spawnSync, type ChildProcess } from "child_process";

type ChunkSink = (chunk: Buffer) => void;

const FRAG_DURATION_US = 200_000; // 200 ms fragments — the latency floor

// Per-viewer registration. `send` pushes a chunk to the viewer's WebSocket;
// `forceClose` tells the WebSocket to close so the viewer's client-side
// auto-reconnect logic re-establishes a clean session. The latter is what
// lets `exit`/`error` on the encoder recover lingering viewers — without
// it, a dead ffmpeg leaves them sitting on a frozen video forever.
interface StreamClient {
  send: ChunkSink;
  forceClose: () => void;
}

let ffmpeg: ChildProcess | null = null;
let currentDisplay: string | null = null;
let onLog: ((msg: string, err?: boolean) => void) | null = null;

// Viewers currently receiving live boxes.
const sinks = new Set<StreamClient>();
// Viewers that have the init segment but are waiting for the next `moof`
// boundary before they start receiving live boxes (so they never begin
// mid-fragment, which MSE can't decode).
const pendingSinks = new Set<StreamClient>();
// Viewers that connected during the encoder's startup window — after some
// ftyp/moov bytes had been emitted but BEFORE the first moof finalized the
// init segment. We can't replay a partial init to them, so they're held
// here until the first moof; at that point we replay the finalized
// initSegment and admit them straight into sinks.
const awaitingInit = new Set<StreamClient>();

// fMP4 demux state (reset on each ffmpeg start).
let initSegment: Buffer | null = null; // ftyp + moov, replayed to late joiners
let initBuilding: Buffer = Buffer.alloc(0); // accumulates ftyp/moov before first moof
let boxAccum: Buffer = Buffer.alloc(0); // incomplete trailing bytes between boxes

function log(msg: string, err = false): void {
  onLog?.(`[stream] ${msg}`, err);
}

export function configureStreamLogger(fn: (msg: string, err?: boolean) => void): void {
  onLog = fn;
}

// Resolve the active display's geometry once per ffmpeg session. The daemon's
// own Xvfb is 1280x1024 (orca/core.ts), but if DISPLAY is pre-set to a real X
// server or a Codespaces-supplied screen, `ensureDisplay()` keeps that and
// the dims will differ. Hard-coding `-video_size 1280x1024` against a
// smaller display crashes ffmpeg ("Invalid capture area"); against a larger
// one, only the top-left region streams and the focus overlay scales wrong.
//
// Pinning matters too: the older `x11grab.c` AVOption table defaults to
// 'vga' (640x480) when -video_size is unset. The current xcbgrab backend
// defaults to the full display, but explicitly pinning to the queried
// geometry keeps capture correct across FFmpeg version drift.
//
// Result is cached per-display since the framebuffer geometry doesn't change
// at runtime. Returns the 1280x1024 daemon default if xdotool can't answer
// (then ffmpeg will report a meaningful capture-area error if that's wrong).
export const DAEMON_FRAMEBUFFER = { width: 1280, height: 1024 } as const;

const geometryCache = new Map<string, { width: number; height: number }>();

export function getCaptureSize(display: string): { width: number; height: number } {
  const cached = geometryCache.get(display);
  if (cached) return cached;

  try {
    const r = spawnSync("xdotool", ["getdisplaygeometry"], {
      env: { ...process.env, DISPLAY: display },
      encoding: "utf-8",
      timeout: 3_000,
    });
    if (r.status === 0) {
      const [w, h] = (r.stdout || "").trim().split(/\s+/).map(Number);
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        const size = { width: w, height: h };
        geometryCache.set(display, size);
        return size;
      }
    }
    log(`xdotool getdisplaygeometry on ${display} produced no usable output (status=${r.status})`, true);
  } catch (e) {
    log(`xdotool getdisplaygeometry on ${display} failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }

  geometryCache.set(display, DAEMON_FRAMEBUFFER);
  return DAEMON_FRAMEBUFFER;
}

// Exported solely so tests can assert the encoder contract (GOP cadence,
// fragment duration, video_size pin). Not part of the public driver API.
export function buildArgs(display: string): string[] {
  const { width, height } = getCaptureSize(display);
  // 30 fps × 0.2 s = 6 frames per fragment. Keeping GOP == fragment size means
  // every cut fragment starts with an IDR, which is what `+frag_keyframe`
  // actually needs to guarantee an independently decodable fragment. Without
  // this, libx264's default ~250-frame GOP means most `moof`s start with a
  // P-frame referencing data a late viewer never received — they get black
  // or frozen video until the next "natural" keyframe ~8 s later. (See
  // ffmpeg-formats(1) on `frag_duration` cutting time-based fragments
  // independent of keyframe placement.)
  const GOP_FRAMES = 6;
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "x11grab",
    "-framerate",
    "30",
    "-video_size",
    `${width}x${height}`,
    "-i",
    display,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-profile:v",
    "baseline",
    "-pix_fmt",
    "yuv420p",
    // Closed-GOP keyframe cadence aligned with the fragment duration.
    "-g",
    String(GOP_FRAMES),
    "-keyint_min",
    String(GOP_FRAMES),
    "-sc_threshold",
    "0", // disable scene-change keyframes so the cadence stays predictable
    "-f",
    "mp4",
    "-movflags",
    "+frag_keyframe+empty_moov+default_base_moof",
    "-frag_duration",
    String(FRAG_DURATION_US),
    "pipe:1",
  ];
}

function broadcast(box: Buffer): void {
  for (const client of sinks) {
    try {
      client.send(box);
    } catch {
      /* a slow/closed client shouldn't take down the encoder */
    }
  }
}

// Forcibly disconnect every viewer (so their auto-reconnect logic picks back
// up against a fresh encoder). Called when ffmpeg exits unexpectedly: we
// can't keep streaming new init segments to clients who already saw the
// previous one without confusing their MSE SourceBuffer. Easier to make
// them reconnect cleanly.
function evictAllClients(): void {
  for (const set of [sinks, pendingSinks, awaitingInit]) {
    for (const client of set) {
      try { client.forceClose(); } catch { /* WS may already be torn down */ }
    }
    set.clear();
  }
}

// Handle one complete top-level MP4 box.
function handleBox(box: Buffer, type: string): void {
  let initJustFinalized = false;
  if (initSegment === null) {
    if (type === "ftyp" || type === "moov") {
      initBuilding = Buffer.concat([initBuilding, box]);
    }
    if (type === "moof") {
      initSegment = initBuilding; // ftyp+moov captured; fragments start here
      initBuilding = Buffer.alloc(0);
      initJustFinalized = true;
    }
  }

  // First moof after a startup-window join: replay the now-finalized init
  // segment to viewers who connected before ftyp/moov was complete, then
  // admit them straight into sinks (they receive this moof via broadcast
  // below). Without this, those viewers' MSE buffer is undecodable.
  if (initJustFinalized && awaitingInit.size && initSegment) {
    for (const client of awaitingInit) {
      try { client.send(initSegment); } catch { /* slow/closed — broadcast loop handles */ }
      sinks.add(client);
    }
    awaitingInit.clear();
  }

  // A moof starts a fresh fragment — the safe point to admit pending viewers.
  if (type === "moof" && pendingSinks.size) {
    for (const s of pendingSinks) sinks.add(s);
    pendingSinks.clear();
  }

  broadcast(box);
}

// Pull complete top-level boxes out of boxAccum and dispatch them.
function parseBoxes(): void {
  while (boxAccum.length >= 8) {
    let size = boxAccum.readUInt32BE(0);
    let headerExtra = 0;
    if (size === 1) {
      // 64-bit largesize lives in bytes 8..16.
      if (boxAccum.length < 16) break;
      size = Number(boxAccum.readBigUInt64BE(8));
      headerExtra = 8;
    } else if (size === 0) {
      // "to end of stream" — can't frame it incrementally; wait for more.
      break;
    }
    if (size < 8 + headerExtra || boxAccum.length < size) break; // incomplete
    const box = boxAccum.subarray(0, size);
    const type = boxAccum.toString("ascii", 4, 8);
    boxAccum = boxAccum.subarray(size);
    handleBox(box, type);
  }
}

function resetDemux(): void {
  initSegment = null;
  initBuilding = Buffer.alloc(0);
  boxAccum = Buffer.alloc(0);
}

function startFfmpeg(display: string): void {
  currentDisplay = display;
  resetDemux();
  log(`spawning ffmpeg x11grab on ${display}`);
  const proc = spawn("ffmpeg", buildArgs(display), {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DISPLAY: display },
  });
  ffmpeg = proc;

  proc.stdout?.on("data", (chunk: Buffer) => {
    // SIGTERM doesn't drain stdout instantly. If a viewer reconnected fast
    // enough that we've already replaced ffmpeg with a new encoder, this
    // listener is for a superseded process — ignore its late bytes,
    // otherwise we mutate the new encoder's shared demux state (corrupting
    // boxAccum, possibly setting initSegment from the dead stream's late
    // moof) and the new viewer's MSE buffer becomes undecodable.
    if (ffmpeg !== proc) return;
    boxAccum = boxAccum.length === 0 ? chunk : Buffer.concat([boxAccum, chunk]);
    parseBoxes();
  });

  let stderr = "";
  proc.stderr?.on("data", (d: Buffer) => {
    if (ffmpeg !== proc) return; // same as stdout — don't log late noise as the new encoder
    stderr += d.toString();
    if (stderr.length > 4096) stderr = stderr.slice(-4096);
  });

  // Handle ffmpeg dying. If we're still the current encoder (i.e. nobody
  // intentionally replaced us), reset demux state and boot any lingering
  // viewers so they reconnect against the new encoder cleanly. Without this,
  // the cached initSegment from this dead session would be replayed to the
  // next viewer to arrive, and their MSE would be fed a moof stream that
  // doesn't match — undecodable until everyone reloads.
  function onUnexpectedExit() {
    if (ffmpeg !== proc) return; // someone already replaced us — nothing to clean up
    ffmpeg = null;
    resetDemux();
    const total = sinks.size + pendingSinks.size + awaitingInit.size;
    if (total) {
      log(`evicting ${total} viewer(s) so they reconnect against a fresh encoder`);
      evictAllClients();
    }
  }

  proc.on("exit", (code, signal) => {
    if (code && code !== 0) {
      log(`ffmpeg exited code=${code} signal=${signal}: ${stderr.trim().split("\n").slice(-2).join(" | ")}`, true);
    } else {
      log(`ffmpeg exited (code=${code} signal=${signal})`);
    }
    onUnexpectedExit();
  });

  proc.on("error", (e) => {
    log(`ffmpeg spawn error: ${e.message}`, true);
    onUnexpectedExit();
  });
}

/**
 * Attach a viewer's chunk sink. Starts ffmpeg if it isn't already running.
 * Returns an idempotent disposer that detaches the sink and stops ffmpeg once
 * the last viewer leaves (paired close+error events won't double-stop it).
 *
 * `forceClose` is called by the encoder if ffmpeg dies unexpectedly — the
 * caller should close its WebSocket so the client-side auto-reconnect kicks
 * in and re-establishes a clean session against the next encoder. (If the
 * caller doesn't supply one, a dead ffmpeg just leaves them on frozen video.)
 */
export function addStreamClient(
  sink: ChunkSink,
  display: string,
  forceClose: () => void = () => {},
): () => void {
  const client: StreamClient = { send: sink, forceClose };
  if (initSegment) {
    // Encoder fully running: replay the cached init segment, then wait for
    // the next moof boundary before this sink joins the live broadcast.
    try {
      sink(initSegment);
    } catch {
      /* ignore */
    }
    pendingSinks.add(client);
  } else if (initBuilding.length > 0) {
    // Encoder mid-startup: ftyp/moov has STARTED arriving but no moof yet.
    // We can't replay the partial init, and we can't add to `sinks` because
    // that would deliver only the tail of the init — undecodable. Hold the
    // client until the first moof finalizes the init segment; at that point
    // handleBox replays it and admits them straight into sinks.
    awaitingInit.add(client);
  } else {
    // No init data has arrived yet — we're the first viewer (or the encoder
    // just started). Receive everything from byte zero, including the
    // upcoming ftyp+moov.
    sinks.add(client);
  }

  if (!ffmpeg) startFfmpeg(display);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    sinks.delete(client);
    pendingSinks.delete(client);
    awaitingInit.delete(client);
    if (sinks.size === 0 && pendingSinks.size === 0 && awaitingInit.size === 0 && ffmpeg) {
      log("last viewer left — stopping ffmpeg");
      try {
        ffmpeg.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      ffmpeg = null;
      // Clear the cached init segment + box-accumulator state. Otherwise the
      // NEXT viewer enters the "encoder already running" branch above and is
      // replayed the STALE ftyp/moov from the previous ffmpeg session, then
      // placed in pendingSinks. The fresh ftyp/moov from the restarted
      // encoder gets broadcast to sinks (empty at that point), and the
      // pending viewer joins at the next moof with the wrong init data —
      // its MSE buffer is undecodable until everything restarts again.
      resetDemux();
    }
  };
}

/** The h264/fMP4 MIME the viewer must feed to MediaSource.isTypeSupported. */
export const STREAM_MIME = 'video/mp4; codecs="avc1.42E01E"';

export function streamStatus(): { running: boolean; viewers: number; display: string | null } {
  return { running: !!ffmpeg, viewers: sinks.size + pendingSinks.size + awaitingInit.size, display: currentDisplay };
}

/** Tear down the encoder on daemon shutdown. */
export function stopStream(): void {
  if (ffmpeg) {
    try {
      ffmpeg.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    ffmpeg = null;
  }
  sinks.clear();
  pendingSinks.clear();
  awaitingInit.clear();
  resetDemux();
}
