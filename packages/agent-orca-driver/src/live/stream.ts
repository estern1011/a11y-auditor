/**
 * Live video stream for `/live`: the Xvfb framebuffer encoded as h264 in a
 * fragmented MP4, pushed as binary chunks over a WebSocket and played in the
 * browser via Media Source Extensions.
 *
 * One ffmpeg process is shared by all viewers (ref-counted): it starts when
 * the first `/stream` client connects and is torn down when the last one
 * disconnects, so there's no encoder running while nobody's watching.
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
const sinks = new Set<ChunkSink>();
let currentDisplay: string | null = null;
let onLog: ((msg: string, err?: boolean) => void) | null = null;

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

function startFfmpeg(display: string): void {
  currentDisplay = display;
  log(`spawning ffmpeg x11grab on ${display}`);
  const proc = spawn("ffmpeg", buildArgs(display), {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DISPLAY: display },
  });
  ffmpeg = proc;

  proc.stdout?.on("data", (chunk: Buffer) => {
    for (const sink of sinks) {
      try {
        sink(chunk);
      } catch {
        /* a slow/closed client shouldn't take down the encoder */
      }
    }
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
 * Returns a disposer that detaches the sink and stops ffmpeg once the last
 * viewer leaves.
 */
export function addStreamClient(sink: ChunkSink, display: string): () => void {
  sinks.add(sink);
  if (!ffmpeg) startFfmpeg(display);

  return () => {
    sinks.delete(sink);
    if (sinks.size === 0 && ffmpeg) {
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
  return { running: !!ffmpeg, viewers: sinks.size, display: currentDisplay };
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
}
