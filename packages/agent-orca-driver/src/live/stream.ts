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

import { spawn, type ChildProcess } from "child_process";

type ChunkSink = (chunk: Buffer) => void;

const FRAG_DURATION_US = 200_000; // 200 ms fragments — the latency floor

let ffmpeg: ChildProcess | null = null;
let currentDisplay: string | null = null;
let onLog: ((msg: string, err?: boolean) => void) | null = null;

// Viewers currently receiving live boxes.
const sinks = new Set<ChunkSink>();
// Viewers that have the init segment but are waiting for the next `moof`
// boundary before they start receiving live boxes (so they never begin
// mid-fragment, which MSE can't decode).
const pendingSinks = new Set<ChunkSink>();

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

function buildArgs(display: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "x11grab",
    "-framerate",
    "30",
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
  for (const sink of sinks) {
    try {
      sink(box);
    } catch {
      /* a slow/closed client shouldn't take down the encoder */
    }
  }
}

// Handle one complete top-level MP4 box.
function handleBox(box: Buffer, type: string): void {
  if (initSegment === null) {
    if (type === "ftyp" || type === "moov") {
      initBuilding = Buffer.concat([initBuilding, box]);
    }
    if (type === "moof") {
      initSegment = initBuilding; // ftyp+moov captured; fragments start here
      initBuilding = Buffer.alloc(0);
    }
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
    boxAccum = boxAccum.length === 0 ? chunk : Buffer.concat([boxAccum, chunk]);
    parseBoxes();
  });

  let stderr = "";
  proc.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString();
    if (stderr.length > 4096) stderr = stderr.slice(-4096);
  });

  proc.on("exit", (code, signal) => {
    if (code && code !== 0) {
      log(`ffmpeg exited code=${code} signal=${signal}: ${stderr.trim().split("\n").slice(-2).join(" | ")}`, true);
    } else {
      log(`ffmpeg exited (code=${code} signal=${signal})`);
    }
    if (ffmpeg === proc) ffmpeg = null;
  });

  proc.on("error", (e) => {
    log(`ffmpeg spawn error: ${e.message}`, true);
    if (ffmpeg === proc) ffmpeg = null;
  });
}

/**
 * Attach a viewer's chunk sink. Starts ffmpeg if it isn't already running.
 * Returns an idempotent disposer that detaches the sink and stops ffmpeg once
 * the last viewer leaves (paired close+error events won't double-stop it).
 */
export function addStreamClient(sink: ChunkSink, display: string): () => void {
  if (initSegment) {
    // Encoder already running: replay the init segment, then wait for the
    // next moof boundary before this sink joins the live broadcast.
    try {
      sink(initSegment);
    } catch {
      /* ignore */
    }
    pendingSinks.add(sink);
  } else {
    // No init yet (we're the first viewer, or ffmpeg is just starting) —
    // receive everything from the top, including the upcoming ftyp+moov.
    sinks.add(sink);
  }

  if (!ffmpeg) startFfmpeg(display);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    sinks.delete(sink);
    pendingSinks.delete(sink);
    if (sinks.size === 0 && pendingSinks.size === 0 && ffmpeg) {
      log("last viewer left — stopping ffmpeg");
      try {
        ffmpeg.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      ffmpeg = null;
    }
  };
}

/** The h264/fMP4 MIME the viewer must feed to MediaSource.isTypeSupported. */
export const STREAM_MIME = 'video/mp4; codecs="avc1.42E01E"';

export function streamStatus(): { running: boolean; viewers: number; display: string | null } {
  return { running: !!ffmpeg, viewers: sinks.size + pendingSinks.size, display: currentDisplay };
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
  resetDemux();
}
