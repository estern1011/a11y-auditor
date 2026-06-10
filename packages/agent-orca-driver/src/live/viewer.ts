/**
 * The `/live` viewer page — a self-contained HTML document (no external
 * assets) served by the daemon. It:
 *   1. plays the Xvfb framebuffer video from the `/stream` WebSocket via MSE,
 *   2. overlays a subtle focus rectangle driven by `focus` events from
 *      `/events` (note: this is the VIEWER's overlay — Orca's own focus
 *      indicator is already baked into the captured video, so the overlay
 *      is a diagnostic aid that adds role + name labels, not "what a real
 *      Linux user sees"),
 *   3. renders a live, auto-scrolling transcript panel from `transcript`
 *      (and `phase`) events,
 *   4. forwards keystrokes to the driver's /press endpoint so the operator
 *      can drive Orca directly from the viewer page (Tab, arrows, h/k for
 *      heading/link navigation, etc.). Browser-essential shortcuts (Ctrl+L,
 *      Cmd+anything, F5/Ctrl+R) are passed through to the browser.
 *
 * Framebuffer width/height come from the active DISPLAY (see stream.ts
 * `getCaptureSize`), not a hard-coded constant, so AT-SPI screen-coordinate
 * bboxes scale correctly against whatever ffmpeg actually captured —
 * including non-1280x1024 displays the daemon was attached to (real X
 * servers, Codespaces-provided screens, etc.).
 */

const MIME = 'video/mp4; codecs="avc1.42E01E"';

export function viewerHtml(framebufferWidth: number, framebufferHeight: number): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>agent-orca-driver — live view</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; background: #0d1117; color: #c9d1d9; display: flex; height: 100vh; overflow: hidden; }
  #stage { position: relative; flex: 1 1 auto; display: flex; align-items: center; justify-content: center; background: #000; min-width: 0; }
  #wrap { position: relative; line-height: 0; }
  video { max-width: 100%; max-height: 100vh; display: block; background: #000; }
  /* Subtle overlay — Orca already draws its own focus indicator in the
     captured video; we just add the role+name label and a thin guide. */
  #focus { position: absolute; border: 1px dashed rgba(88,166,255,.7); border-radius: 2px; pointer-events: none; transition: all .12s ease-out; display: none; }
  #focus .label { position: absolute; top: -20px; left: -1px; background: rgba(88,166,255,.92); color: #04122b; font: 600 11px/1.6 system-ui, sans-serif; padding: 0 6px; border-radius: 2px; white-space: nowrap; max-width: 60ch; overflow: hidden; text-overflow: ellipsis; }
  #side { flex: 0 0 360px; display: flex; flex-direction: column; border-left: 1px solid #21262d; background: #0d1117; }
  #side header { padding: 10px 14px; border-bottom: 1px solid #21262d; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  /* Pulse on transcript activity instead of "always green when connected." */
  #dot { width: 9px; height: 9px; border-radius: 50%; background: #30363d; transition: background .25s ease-out, box-shadow .25s ease-out; }
  #dot.pulse { background: #3fb950; box-shadow: 0 0 0 4px rgba(63,185,80,.22); }
  #log { flex: 1 1 auto; overflow-y: auto; padding: 8px 0; }
  .line { padding: 4px 14px; border-bottom: 1px solid #161b22; font-size: 13px; word-break: break-word; }
  .line .src { color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin-right: 6px; }
  .line.phase { color: #d2a8ff; font-style: italic; }
  .line.latest { background: #161b22; }
  #footer { padding: 8px 14px; border-top: 1px solid #21262d; font-size: 12px; color: #8b949e; display: flex; flex-direction: column; gap: 4px; }
  #status { display: flex; align-items: center; gap: 6px; }
  .toggle { display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; }
  .toggle .state { color: #3fb950; font-weight: 600; }
  .toggle.off .state { color: #8b949e; }
  .toggle:hover { color: #c9d1d9; }
  #kbd-hint { font-size: 11px; color: #6e7681; line-height: 1.35; }
</style>
</head>
<body>
  <div id="stage">
    <div id="wrap">
      <video id="v" muted autoplay playsinline></video>
      <div id="focus"><span class="label"></span></div>
    </div>
  </div>
  <aside id="side">
    <header><span id="dot"></span> Orca transcript</header>
    <div id="log"></div>
    <div id="footer">
      <div id="status">connecting…</div>
      <div id="kbd" class="toggle" title="Click to toggle keyboard forwarding">⌨ Control: <span class="state">ON</span></div>
      <div id="overlay" class="toggle" title="Click to hide the focus overlay so you can see the page's own focus styling">▢ Focus overlay: <span class="state">ON</span></div>
      <div id="kbd-hint">Tab, arrows, Enter, Esc, single letters/digits forward to Orca. Ctrl+L / F5 / ⌘-shortcuts pass through to your browser.</div>
    </div>
  </aside>
<script>
(function () {
  var FB_W = ${framebufferWidth}, FB_H = ${framebufferHeight};
  var MIME = ${JSON.stringify(MIME)};
  var wsBase = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

  var video = document.getElementById("v");
  var focusEl = document.getElementById("focus");
  var labelEl = focusEl.querySelector(".label");
  var logEl = document.getElementById("log");
  var statusEl = document.getElementById("status");
  var dotEl = document.getElementById("dot");
  var kbdEl = document.getElementById("kbd");
  var kbdStateEl = kbdEl.querySelector(".state");
  var overlayToggleEl = document.getElementById("overlay");
  var overlayStateEl = overlayToggleEl.querySelector(".state");

  // ---- Video via MSE ----
  if (!("MediaSource" in window) || !MediaSource.isTypeSupported(MIME)) {
    statusEl.textContent = "This browser can't play the h264/MSE stream.";
    return;
  }
  var ms = new MediaSource();
  video.src = URL.createObjectURL(ms);
  var sb = null;
  var queue = [];
  ms.addEventListener("sourceopen", function () {
    sb = ms.addSourceBuffer(MIME);
    sb.mode = "sequence";
    sb.addEventListener("updateend", pump);
    connectStream();
  });
  // Keep ~30s of history behind the playhead during normal play, ~3s after
  // a quota error. Without active eviction MSE eventually hits the browser's
  // SourceBuffer quota; appendBuffer then throws QuotaExceededError and —
  // unless we trim — every subsequent fragment fails too and the video freezes.
  var TRIM_KEEP_SECONDS = 30;
  var QUOTA_RECOVER_SECONDS = 3;
  function trimBehind(keepSeconds) {
    if (!sb || sb.updating || !sb.buffered.length) return false;
    var bufferedStart = sb.buffered.start(0);
    var trimUpTo = video.currentTime - keepSeconds;
    if (trimUpTo > bufferedStart) {
      try { sb.remove(bufferedStart, trimUpTo); return true; } catch (e) {}
    }
    return false;
  }
  function pump() {
    if (!sb || sb.updating || queue.length === 0) return;
    if (trimBehind(TRIM_KEEP_SECONDS)) return;
    var chunk = queue[0];
    try {
      sb.appendBuffer(chunk);
      queue.shift();
    } catch (e) {
      if (e && e.name === "QuotaExceededError") {
        trimBehind(QUOTA_RECOVER_SECONDS);
      } else {
        queue.shift();
      }
    }
  }
  function connectStream() {
    var ws = new WebSocket(wsBase + "/stream");
    ws.binaryType = "arraybuffer";
    ws.onopen = function () { statusEl.textContent = "streaming"; };
    ws.onmessage = function (ev) { queue.push(new Uint8Array(ev.data)); pump(); };
    ws.onclose = function () { statusEl.textContent = "stream closed — retrying…"; setTimeout(connectStream, 1000); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  // ---- Events (transcript + focus + phase) ----
  function scaleBox(b) {
    var vw = video.clientWidth || FB_W, vh = video.clientHeight || FB_H;
    var sx = vw / FB_W, sy = vh / FB_H;
    return { left: b.x * sx, top: b.y * sy, width: b.w * sx, height: b.h * sy };
  }
  // Cache the latest focus event so toggling the overlay back on snaps the
  // rectangle to the current SR position without waiting for the next /next.
  var lastFocus = null;
  var overlayEnabled = true;
  function showFocus(ev) {
    lastFocus = ev;
    if (!overlayEnabled) { focusEl.style.display = "none"; return; }
    if (!ev || !ev.bbox || (ev.bbox.w === 0 && ev.bbox.h === 0)) { focusEl.style.display = "none"; return; }
    var s = scaleBox(ev.bbox);
    focusEl.style.display = "block";
    focusEl.style.left = s.left + "px";
    focusEl.style.top = s.top + "px";
    focusEl.style.width = s.width + "px";
    focusEl.style.height = s.height + "px";
    labelEl.textContent = (ev.role ? ev.role + ": " : "") + (ev.name || "");
  }
  function setOverlay(on) {
    overlayEnabled = on;
    overlayToggleEl.classList.toggle("off", !on);
    overlayStateEl.textContent = on ? "ON" : "OFF";
    showFocus(lastFocus);
  }
  overlayToggleEl.addEventListener("click", function () { setOverlay(!overlayEnabled); });
  function addLine(cls, html) {
    var prev = logEl.querySelector(".latest");
    if (prev) prev.classList.remove("latest");
    var div = document.createElement("div");
    div.className = "line latest " + cls;
    div.innerHTML = html;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.children.length > 500) logEl.removeChild(logEl.firstChild);
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]; }); }
  // Pulse the activity dot on each new transcript line; CSS handles the fade.
  var pulseTimer = null;
  function pulse() {
    dotEl.classList.add("pulse");
    if (pulseTimer) clearTimeout(pulseTimer);
    pulseTimer = setTimeout(function () { dotEl.classList.remove("pulse"); }, 400);
  }
  function connectEvents() {
    var ws = new WebSocket(wsBase + "/events");
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === "transcript") {
        // Default source is Orca — only show the source badge when an
        // orchestrator tagged a non-orca push (e.g. a synthetic phase tag).
        var prefix = (m.source && m.source !== "orca")
          ? '<span class="src">' + esc(m.source) + '</span>'
          : "";
        addLine("", prefix + esc(m.text));
        pulse();
      } else if (m.type === "phase") {
        addLine("phase", "— " + esc(m.name) + " —");
      } else if (m.type === "focus") {
        showFocus(m);
      }
    };
    ws.onclose = function () { setTimeout(connectEvents, 1000); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  connectEvents();

  // ---- Keyboard control: forward to /press ----
  // Driver key-name mapping — the daemon's KEY_MAP in orca/core.ts accepts
  // these names. Letters / digits pass through as-is via the single-char fallback.
  var KEY_MAP = {
    Tab: "Tab", Enter: "Return", Escape: "Escape", Backspace: "BackSpace", Delete: "Delete",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    Home: "Home", End: "End", PageUp: "Prior", PageDown: "Next",
    " ": "space",
    F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6",
    F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12",
  };
  // Browser shortcuts we deliberately let through to the operator's browser,
  // so the address bar / reload / devtools / tab management still work.
  var BROWSER_PASSTHROUGH_CTRL = { L: 1, T: 1, W: 1, R: 1, F: 1, D: 1, N: 1, P: 1, S: 1, U: 1, J: 1 };
  var kbdEnabled = true;
  function setKbd(on) {
    kbdEnabled = on;
    kbdEl.classList.toggle("off", !on);
    kbdStateEl.textContent = on ? "ON" : "OFF";
  }
  kbdEl.addEventListener("click", function () { setKbd(!kbdEnabled); });

  document.addEventListener("keydown", function (e) {
    if (!kbdEnabled) return;
    // ⌘ on macOS — always pass through.
    if (e.metaKey) return;
    // Browser-essential Ctrl combos (address bar, reload, devtools, etc.).
    if (e.ctrlKey && e.key.length === 1 && BROWSER_PASSTHROUGH_CTRL[e.key.toUpperCase()]) return;
    // F5 and F12 stay with the browser too (reload, devtools).
    if (e.key === "F5" || e.key === "F12") return;

    var key = KEY_MAP[e.key];
    if (!key && e.key.length === 1) key = e.key; // letter / digit / punctuation
    if (!key) return;

    e.preventDefault();
    var modifiers = [];
    if (e.shiftKey) modifiers.push("shift");
    if (e.ctrlKey)  modifiers.push("ctrl");
    if (e.altKey)   modifiers.push("alt");

    fetch("/press", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: key, modifiers: modifiers }),
    }).catch(function () { /* daemon offline — swallow */ });
  });
})();
</script>
</body>
</html>`;
}
