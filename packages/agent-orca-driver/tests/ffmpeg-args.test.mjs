/**
 * Contract tests for the ffmpeg argument list — locks in the codex findings:
 *   - `-video_size` is pinned (no VGA fallback).
 *   - GOP cadence (`-g`, `-keyint_min`) matches `-frag_duration` so every
 *     `moof` is also an IDR (late-viewer recovery).
 *   - `-sc_threshold 0` keeps the cadence predictable.
 *   - `+frag_keyframe`, `empty_moov`, `default_base_moof` are still set.
 *
 * If any of these regress, the comment chain on PR #28 will replay.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { buildArgs, DAEMON_FRAMEBUFFER } from "../dist/src/live/stream.js";

// xdotool will fail without a display; getCaptureSize falls back to
// DAEMON_FRAMEBUFFER. That's the path we exercise here.
const args = buildArgs(":99");
const argString = args.join(" ");

function flagValue(flag) {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  return args[i + 1];
}

test("input is x11grab at 30 fps", () => {
  assert.equal(flagValue("-f"), "x11grab", "first -f is x11grab");
  assert.equal(flagValue("-framerate"), "30");
});

test("-video_size is pinned (no VGA fallback)", () => {
  const size = flagValue("-video_size");
  assert.equal(size, `${DAEMON_FRAMEBUFFER.width}x${DAEMON_FRAMEBUFFER.height}`);
});

test("GOP cadence matches the 200 ms fragment duration", () => {
  // 30 fps × 0.2 s = 6 frames per fragment.
  assert.equal(flagValue("-g"), "6", "-g should be 6 frames");
  assert.equal(flagValue("-keyint_min"), "6", "-keyint_min should be 6 frames");
  assert.equal(flagValue("-sc_threshold"), "0", "-sc_threshold disabled");
  assert.equal(flagValue("-frag_duration"), "200000", "200 ms in microseconds");
});

test("encoder is libx264 baseline at zero-latency", () => {
  assert.equal(flagValue("-c:v"), "libx264");
  assert.equal(flagValue("-preset"), "ultrafast");
  assert.equal(flagValue("-tune"), "zerolatency");
  assert.equal(flagValue("-profile:v"), "baseline");
  assert.equal(flagValue("-pix_fmt"), "yuv420p");
});

test("movflags carries frag_keyframe + empty_moov + default_base_moof", () => {
  const flags = flagValue("-movflags") || "";
  assert.match(flags, /\+frag_keyframe\b/);
  assert.match(flags, /\bempty_moov\b/);
  assert.match(flags, /\bdefault_base_moof\b/);
});

test("output is fragmented MP4 to stdout", () => {
  // Output `-f mp4` is the LAST -f in the list (input `-f x11grab` comes first).
  const fFlags = args.reduce((acc, a, i) => (a === "-f" ? [...acc, args[i + 1]] : acc), []);
  assert.equal(fFlags[fFlags.length - 1], "mp4");
  assert.equal(args[args.length - 1], "pipe:1");
});
