/**
 * The `/live` viewer page — a self-contained HTML document (no external
 * assets) served by the daemon. It:
 *   1. plays the Xvfb framebuffer video from the `/stream` WebSocket via MSE,
 *   2. overlays a focus rectangle driven by `focus` events from `/events`,
 *   3. renders a live, auto-scrolling transcript panel from `transcript`
 *      (and `phase`) events.
 *
 * Framebuffer is 1280x1024 (see core.ts Xvfb geometry); the overlay scales
 * AT-SPI screen-coordinate bboxes into the displayed <video> size.
 */

export const FRAMEBUFFER_WIDTH = 1280;
export const FRAMEBUFFER_HEIGHT = 1024;

const MIME = 'video/mp4; codecs="avc1.42E01E"';

export function viewerHtml(): string {
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
  #focus { position: absolute; border: 3px solid #58a6ff; box-shadow: 0 0 0 2px rgba(0,0,0,.6), 0 0 12px rgba(88,166,255,.8); border-radius: 3px; pointer-events: none; transition: all .12s ease-out; display: none; }
  #focus .label { position: absolute; top: -22px; left: -3px; background: #58a6ff; color: #04122b; font: 600 12px/1.6 system-ui, sans-serif; padding: 0 6px; border-radius: 3px; white-space: nowrap; max-width: 60ch; overflow: hidden; text-overflow: ellipsis; }
  #side { flex: 0 0 360px; display: flex; flex-direction: column; border-left: 1px solid #21262d; background: #0d1117; }
  #side header { padding: 10px 14px; border-bottom: 1px solid #21262d; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  #dot { width: 9px; height: 9px; border-radius: 50%; background: #f85149; }
  #dot.on { background: #3fb950; }
  #log { flex: 1 1 auto; overflow-y: auto; padding: 8px 0; }
  .line { padding: 4px 14px; border-bottom: 1px solid #161b22; font-size: 13px; word-break: break-word; }
  .line .src { color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin-right: 6px; }
  .line.phase { color: #d2a8ff; font-style: italic; }
  .line.latest { background: #161b22; }
  #status { padding: 8px 14px; border-top: 1px solid #21262d; font-size: 12px; color: #8b949e; }
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
    <div id="status">connecting…</div>
  </aside>
<script>
(function () {
  var FB_W = ${FRAMEBUFFER_WIDTH}, FB_H = ${FRAMEBUFFER_HEIGHT};
  var MIME = ${JSON.stringify(MIME)};
  var wsBase = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

  var video = document.getElementById("v");
  var focusEl = document.getElementById("focus");
  var labelEl = focusEl.querySelector(".label");
  var logEl = document.getElementById("log");
  var statusEl = document.getElementById("status");
  var dotEl = document.getElementById("dot");

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
  function pump() {
    if (!sb || sb.updating || queue.length === 0) return;
    try { sb.appendBuffer(queue.shift()); } catch (e) { /* overflow — drop */ queue.length = 0; }
  }
  function connectStream() {
    var ws = new WebSocket(wsBase + "/stream");
    ws.binaryType = "arraybuffer";
    ws.onopen = function () { dotEl.classList.add("on"); statusEl.textContent = "streaming"; };
    ws.onmessage = function (ev) { queue.push(new Uint8Array(ev.data)); pump(); };
    ws.onclose = function () { dotEl.classList.remove("on"); statusEl.textContent = "stream closed — retrying…"; setTimeout(connectStream, 1000); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  // ---- Events (transcript + focus + phase) ----
  function scaleBox(b) {
    var vw = video.clientWidth || FB_W, vh = video.clientHeight || FB_H;
    var sx = vw / FB_W, sy = vh / FB_H;
    return { left: b.x * sx, top: b.y * sy, width: b.w * sx, height: b.h * sy };
  }
  function showFocus(ev) {
    if (!ev.bbox || (ev.bbox.w === 0 && ev.bbox.h === 0)) { focusEl.style.display = "none"; return; }
    var s = scaleBox(ev.bbox);
    focusEl.style.display = "block";
    focusEl.style.left = s.left + "px";
    focusEl.style.top = s.top + "px";
    focusEl.style.width = s.width + "px";
    focusEl.style.height = s.height + "px";
    labelEl.textContent = (ev.role ? ev.role + ": " : "") + (ev.name || "");
  }
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
  function connectEvents() {
    var ws = new WebSocket(wsBase + "/events");
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === "transcript") addLine("", '<span class="src">' + esc(m.source) + '</span>' + esc(m.text));
      else if (m.type === "phase") addLine("phase", "— " + esc(m.name) + " —");
      else if (m.type === "focus") showFocus(m);
    };
    ws.onclose = function () { setTimeout(connectEvents, 1000); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  connectEvents();
})();
</script>
</body>
</html>`;
}
