# Security Review — a11y-auditor

**Methodology:** [vercel-labs/deepsec](https://github.com/vercel-labs/deepsec/) (regex candidate scan → AI investigation → triage → report)
**Reviewer:** Claude Opus 4.7
**Date:** 2026-05-11
**Branch reviewed:** `main` (commit 8e06463) on `claude/security-review-deepsec-5cGU8`
**Scope:** Full repository — CLI, HTTP driver server, VoiceOver/Orca cores, audit/collect tooling, eval pipeline, setup scripts. Excludes third-party dependencies (`@guidepup/guidepup`, `playwright`, `dbus-native`, `agent-browser`).

---

## Threat model

a11y-auditor is a developer/CI tool that runs on the operator's machine. It:

- Spawns a headed Chromium via Playwright with CDP exposed on `127.0.0.1:9222` (or `:9223`).
- Runs a daemon HTTP server on `127.0.0.1:7483` (or `:7484`) that drives the screen reader, the page, and arbitrary keystrokes.
- Drives VoiceOver via `osascript` on macOS, or Orca via AT-SPI2 D-Bus on Linux.
- Navigates to arbitrary URLs supplied by the operator and runs axe-core / `agent-browser` against them.

The realistic threat actors are:

1. **A malicious web page** the operator visits while the driver is running (DNS-rebinding against the loopback server / CDP port).
2. **A local unprivileged user** on the same multi-user host (TOCTOU on `/tmp` state files).
3. **An audit target page itself** — but the whole point is to load untrusted pages, so this is largely accepted risk. The concern is whether a malicious page can break out of the test browser into the operator's environment.

We are **not** modelling: a hostile operator (they own the machine), supply-chain compromise of Bun/Playwright/agent-browser, or kernel-level escapes from Chromium.

---

## Summary

| # | Severity | Finding | File / Line |
|---|----------|---------|-------------|
| 1 | **High** | Loopback driver API has no Host/Origin check — DNS-rebinding gives any malicious web page full control of the headed browser + screen reader | `drivers/server.ts:67-275, 301` |
| 2 | Medium | `/navigate` passes the URL straight to `page.goto` with no scheme allow-list — combined with #1, gives a remote attacker a local-file/`chrome://` read primitive | `drivers/voiceover/core.ts:554-566`, `drivers/orca/core.ts:637-649` |
| 3 | Medium | Predictable `/tmp/*` paths for log / pid / state files are written via `writeFileSync` and read for `process.kill` — symlink TOCTOU on shared / CI hosts | `drivers/voiceover/core.ts:50-52, 159, 526`, `drivers/orca/core.ts:41-43, 160`, `drivers/orca/speech.ts:30, 88, 124`, `cli.ts:204` |
| 4 | Medium | `cli kill` reads `/tmp/{vo,orca}-driver-state.json` then runs `defaults write … -int $X` / `osascript … VoiceOver quit` / `pkill -x orca` — a writable state file lets a local attacker terminate the operator's pre-existing VoiceOver/Orca session and overwrite their speech-rate pref | `cli.ts:202-238` |
| 5 | Low | `eval/sprite-bootstrap.sh` runs `git checkout "$BRANCH"` without `--`; a `$BRANCH` value starting with `-` is parsed as an option | `eval/sprite-bootstrap.sh:31` |
| 6 | Low | `page.evaluate(\`${OBSERVER_INJECT}(${settleMs})\`)` interpolates a number into a JS string template; currently safe because `typeof === "number"` is enforced upstream, but the pattern invites regression | `drivers/wait.ts:314` |
| 7 | Info | Playwright is launched with `--remote-debugging-port=${cdpPort}` only — no explicit `--remote-debugging-address=127.0.0.1` | `drivers/voiceover/core.ts:485`, `drivers/orca/core.ts:594` |
| 8 | Info | `eval/sprite-bootstrap.sh` does `curl https://bun.sh/install \| bash` and `npm i -g agent-browser` from main — accepted supply-chain risk worth noting in the README | `eval/sprite-bootstrap.sh:23, 39-48` |

No command-injection, AppleScript-injection, or RCE primitives were found in the surfaces exposed to network/local-attacker input. The single-character `osascript` keystroke path (`drivers/voiceover/core.ts:404-405`) escapes `"` and `\` correctly and is length-bounded to one code unit.

---

## Findings

### 1. Loopback driver API has no Host header / Origin check — DNS-rebinding to RCE-adjacent

**Severity:** High
**Location:** `drivers/server.ts:67-275` (request handler), `drivers/server.ts:301` (`server.listen(port, "127.0.0.1", …)`)
**CWE:** CWE-350 (Reliance on Reverse DNS Resolution for a Security-Critical Action) / CWE-1385

The driver daemon listens on `127.0.0.1` and exposes a powerful unauthenticated JSON API:

- `POST /navigate {url}` — `page.goto(url)` in the headed browser.
- `POST /press {key, modifiers}` — synthesises real keystrokes via AppleScript / AT-SPI2.
- `POST /perform {command}` — runs an arbitrary entry from the screen-reader command table.
- `POST /audit {selector, tags, rules}` — runs axe-core; returns full HTML/aria snapshot of the loaded page.
- `POST /stop` — terminates the daemon.
- `GET  /transcript` — returns the running screen-reader transcript.

Binding to `127.0.0.1` blocks direct remote access. **It does not block DNS rebinding.** The handler never inspects `req.headers.host` (`drivers/server.ts:73` builds the URL with a hard-coded `http://localhost` base and ignores the actual `Host`) and never inspects `Origin`. A page served from `attacker.example` whose A record TTL has flipped to `127.0.0.1` can `fetch("http://attacker.example:7483/navigate", …)`, and the browser's same-origin policy will let the attacker read the response because the origin (`attacker.example`) matches.

**Practical exploit chain (with finding #2):**
1. Operator runs `bun drivers/voiceover/driver.ts start https://corp-intranet/`.
2. While the audit is paused, operator opens an unrelated tab to a malicious page.
3. Malicious page rebinds its hostname to `127.0.0.1` and POSTs `{"url":"file:///Users/op/.aws/credentials"}` to `/navigate`, then GETs `/transcript`, or queries `/audit` (which returns the page's text in `tree` / axe nodes). Credentials are exfiltrated to the attacker.

**Recommended fix:**
- Validate `req.headers.host` against an allow-list of `127.0.0.1[:port]` and `localhost[:port]` before dispatching any route.
- Reject any request whose `Origin` header is present and is **not** `http://127.0.0.1:<port>` or `http://localhost:<port>`. In particular, **reject the literal string `null`** — sandboxed iframes, `data:` documents, and `file:` documents serialize their origin as `Origin: null`, and they can still issue simple cross-origin POSTs (e.g. `Content-Type: text/plain` carrying JSON) that fire side-effect endpoints like `/stop`, `/navigate`, and `/press`. CORS only prevents the attacker from *reading* the response — it doesn't block the request itself.
- Allowing a missing `Origin` header is acceptable for the CLI / non-browser callers (Node's `fetch` and `curl` don't send one by default). Browsers always send an `Origin` for cross-origin requests, so absence is a non-browser signal.
- Optionally require a per-launch random bearer token written into the pid file (and read by `cli.ts`).

Minimal patch sketch (matches the prose above — rejects literal `null`, allows a missing header, **pins the allowed origin to the driver port**):

```ts
// inside handle(...)
const host = (req.headers.host || "").toLowerCase();
const okHost = host === `127.0.0.1:${port}` || host === `localhost:${port}`;
if (!okHost) { json(res, 403, { error: "bad host" }); return; }
const origin = req.headers.origin;
const allowedOrigins = new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
]);
if (origin !== undefined && !allowedOrigins.has(origin.toLowerCase())) {
  // The literal string "null" (sent by sandboxed iframes / data: / file:)
  // is not in the set and is rejected here. Any other-port localhost dev
  // server (e.g. http://localhost:3000) is also rejected — only the
  // driver's own port is allowed.
  json(res, 403, { error: "bad origin" }); return;
}
```

Important: do **not** use a regex like `/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/` — that allows any port, which lets a malicious/compromised dev server on another localhost port (e.g. `http://localhost:3000`) drive `/navigate`, `/press`, or `/stop`. Compare against the exact `:${port}` only.

### 2. `/navigate` accepts any URL scheme — `file://`, `chrome://`, `javascript:` all permitted

**Severity:** Medium (escalates the impact of #1; in isolation requires local access)
**Location:** `drivers/voiceover/core.ts:554-566`, `drivers/orca/core.ts:637-649`, `drivers/server.ts:133-141`

```ts
if (path === "/navigate" && method === "POST") {
  ...
  if (!body?.url || typeof body.url !== "string") { ... }
  json(res, 200, await driver.navigate(body.url));
}
```

`driver.navigate` does `state.page.goto(url, { waitUntil: "load" })` with no validation. Chromium allows `file://` URLs by default. Combined with the `/audit` endpoint (which calls `page.ariaSnapshot({ mode: "ai" })` and returns the HTML of the located content) or with `agent-browser eval "document.body.innerText"` on the same CDP port, this is a stable local-file-read primitive.

`javascript:` URLs in `page.goto` are a no-op in modern Chromium, and `chrome://` URLs are partially restricted, but `file://` is the most damaging case and works today.

**Recommended fix:**
- Reject `body.url` unless it parses as `http://`, `https://`, or `data:`. Example:
  ```ts
  let u: URL;
  try { u = new URL(body.url); } catch { json(res, 400, { error: "invalid URL" }); return; }
  if (!["http:", "https:", "data:"].includes(u.protocol)) {
    json(res, 400, { error: `scheme ${u.protocol} not allowed` }); return;
  }
  ```
- Apply the same check in `cli.ts` for the `start <url>` and `navigate <url>` paths so the daemon never sees an unsafe scheme.

### 3. Predictable `/tmp` paths — symlink-following writes / TOCTOU

**Severity:** Medium (only impactful on multi-user / shared CI hosts)
**Location:** Constants at `drivers/voiceover/core.ts:50-52`, `drivers/orca/core.ts:41-43`, `drivers/orca/speech.ts:30`; writes at `drivers/voiceover/core.ts:159, 526`, `drivers/orca/core.ts:160, 629`, `drivers/orca/speech.ts:88, 124, 209`, `drivers/server.ts:288, 306`; reads at `cli.ts:204, 211, 230`.
**CWE:** CWE-377 (Insecure Temporary File), CWE-59 (Link Following)

All log / pid / state / speech-capture files live at fixed paths under `/tmp`:

```
/tmp/vo-driver.log
/tmp/vo-driver.pid
/tmp/vo-driver-state.json
/tmp/orca-driver.log
/tmp/orca-driver.pid
/tmp/orca-driver-state.json
/tmp/orca-speech.log
```

On a multi-user host, a local unprivileged attacker can pre-create a symlink at any of these paths pointing at a target file the driver user has write access to (e.g. `~/.ssh/authorized_keys`, `~/.bashrc`). `writeFileSync` follows symlinks, so the target file gets truncated or overwritten with attacker-influenced content (the PID, the JSON state, log lines that include the URL the operator is auditing — controllable in part by the attacker).

The PID file is then read back unconditionally:

```ts
// cli.ts:204
const pid = parseInt(readFileSync(driver.pidFile, "utf-8"), 10);
process.kill(pid, "SIGKILL");
```

If the attacker swapped the symlink for a file whose first integer is the PID of another process owned by the driver user, `cli kill` will SIGKILL that process.

**Recommended fix:**
- Move state to `os.tmpdir()`-derived per-user directories (`mkdtempSync` once, store the path in an env var or in the user's home), or to `${XDG_RUNTIME_DIR:-$HOME/.cache/a11y-auditor}`.
- Open writes with `O_NOFOLLOW | O_CREAT | O_EXCL` for first creation, and `O_NOFOLLOW` for appends, refusing to proceed if a symlink is detected.
- Validate the pid file before killing. **Use `lstatSync`, not `statSync`** — `statSync` follows the symlink and returns the stats of the target, so `isSymbolicLink()` is always `false` for a symlinked PID file (the attacker wins). With `lstatSync` you see the symlink itself:
  ```ts
  const st = fs.lstatSync(pidFile);
  if (st.isSymbolicLink()) throw new Error("refusing to kill: pid file is a symlink");
  if (st.uid !== process.geteuid?.()) throw new Error("refusing to kill: pid file not owned by us");
  // Then read with O_NOFOLLOW so a swap between lstat and read still fails:
  const fd = fs.openSync(pidFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { /* read pid from fd */ } finally { fs.closeSync(fd); }
  ```

### 4. State-file-driven `defaults write` / `osascript quit` / `pkill orca` in `cli kill`

**Severity:** Medium
**Location:** `cli.ts:202-238`
**CWE:** CWE-426 (Untrusted Search Path)-adjacent / CWE-367 (TOCTOU)

`cli kill` reads `/tmp/{vo,orca}-driver-state.json` and uses its contents to decide whether to:

- `defaults write com.apple.VoiceOver4/default <key> -int <stateData.originalSpeechRate>`
- `osascript -e 'tell application "VoiceOver" to quit'`
- `pkill -x orca`

If the attacker from #3 also controls the state file, they can:

- Set `weStartedVoiceOver: true` to make the operator's pre-existing VoiceOver session get quit unexpectedly when they next run `cli kill`.
- Set `originalSpeechRate` to a bogus value to clobber the operator's speech-rate preference. (`defaults … -int X` parses X as an integer and zeroes on garbage, so this is not RCE — it is a denial of accessibility.)
- Set `weStartedOrca: true` to trigger `pkill -x orca` on the operator's running Orca.

This is the same root cause as #3 — fixing #3 fixes this.

### 5. `git checkout "$BRANCH"` without `--`

**Severity:** Low
**Location:** `eval/sprite-bootstrap.sh:31`

```bash
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH" || true
```

`$BRANCH` is a script argument supplied by the operator. If it starts with `-` (e.g. `--orphan`, `-q`, or a future option that git ships), `git checkout` will parse it as a flag rather than a branch name. Currently the worst case is benign — `git checkout --orphan foo` doesn't run code — but the same idiom in `git pull origin "$BRANCH"` is also suspect.

**Recommended fix:** *Do not* use `git checkout -- "$BRANCH"` — after `--`, `git checkout` treats its arguments as **file pathspecs**, not as a branch/ref, so `git checkout -- main` tries to restore a file named `main` and never actually switches branches. The correct fixes are:

1. **Validate the ref name** before passing it to git. Refuse anything that starts with `-` or contains shell-meta characters:
   ```bash
   case "$BRANCH" in
     -*|*[![:alnum:]/._-]*) echo "invalid branch name: $BRANCH" >&2; exit 1 ;;
   esac
   git fetch origin -- "$BRANCH"
   git switch "$BRANCH"            # git switch only takes refs, not pathspecs
   git pull origin -- "$BRANCH"
   ```
   `git switch` is preferable to `git checkout` here because it has a smaller flag surface and does not overload the same command with pathspec semantics.

2. Or use `git -c protocol.file.allow=user` plus an explicit ref form: `git switch --detach "refs/heads/$BRANCH"` — this still allows `-` prefixes through to git, so it isn't a substitute for validation, but it makes the operation idempotent.

The original report's suggestion (`git checkout -- "$BRANCH"`) was wrong and would break the default `main` case.

### 6. JS template-literal interpolation of `settleMs` in `page.evaluate`

**Severity:** Low (currently safe; pattern is brittle)
**Location:** `drivers/wait.ts:314`

```ts
await page.evaluate(`${OBSERVER_INJECT}(${settleMs})`);
```

`settleMs` reaches this line from `server.ts:200`:

```ts
const settleMs = typeof body?.settleMs === "number" ? body.settleMs : undefined;
```

`JSON.parse` only produces primitive numbers, so the `typeof` guard is sufficient — `NaN` / `Infinity` interpolate as `NaN` / `Infinity` (valid JS identifiers) and cause no harm. However, any future refactor that loosens that guard (e.g. coercing a string to a number with `parseInt`, or reading the value from another endpoint) would turn this into a direct JS-injection sink in the test browser.

**Recommended fix:** pass `settleMs` as a parameter instead of string-interpolating it:

```ts
await page.evaluate(
  (settleMs) => { (new Function("settleMs", `(${OBSERVER_INJECT})(settleMs)`))(settleMs); },
  settleMs,
);
```

Or refactor `OBSERVER_INJECT` to a function literal and use `page.evaluate(observerFn, settleMs)`.

### 7. Playwright CDP port has no explicit bind address

**Severity:** Info
**Location:** `drivers/voiceover/core.ts:485`, `drivers/orca/core.ts:594`

```ts
args: [`--remote-debugging-port=${cdpPort}`]
```

Modern Chromium defaults `--remote-debugging-port` to bind to `127.0.0.1`, so this is currently safe. To future-proof against a Chromium change and to be explicit:

```ts
args: [`--remote-debugging-port=${cdpPort}`, `--remote-debugging-address=127.0.0.1`]
```

The same DNS-rebinding caveat from finding #1 also applies to the CDP port — Chrome's CDP implements its own protection (it rejects WebSocket upgrades whose `Host` header isn't `localhost`/`127.0.0.1`), so this surface is much harder to abuse, but worth keeping in mind.

### 8. Bootstrap installer pattern

**Severity:** Info
**Location:** `eval/sprite-bootstrap.sh:23, 39-48`

```bash
curl -fsSL https://bun.sh/install | bash
...
sudo bash drivers/orca/setup.sh
...
npm i -g agent-browser
```

Pipe-curl-to-bash and `npm -g` from `main` are standard developer-tooling patterns but are worth documenting in the README under "what this script trusts" so new operators understand the supply-chain surface they're accepting.

---

## What I checked and cleared

Listing these so a future reviewer can skip past them.

- **AppleScript injection** — `voPress` (`drivers/voiceover/core.ts:389-423`). `key` is either a `KEY_CODES` table lookup (no interpolation) or a single character, which is escaped (`\\` and `\"`). `modifiers` are filtered against `VALID_MODIFIERS` before interpolation. **Safe.**
- **VO commander injection** — `voPerform` (`drivers/voiceover/core.ts:259-292`). `commandName` is used as an object-key lookup, never interpolated into AppleScript. **Safe.**
- **Orca AT-SPI2 key injection** — `generateKeyboardEvent` (`drivers/orca/atspi.ts:338-403`). Keys go through a numeric keysym table or `key.charCodeAt(0)` for length-1 strings. Modifiers go through `VALID_MODIFIERS`. **Safe.**
- **`/perform`, `/press`, `/wait-for-selector` body parsing** — `server.ts` rejects missing / wrong-type fields with 400. `parseBody` returns `null` on bad JSON without throwing. **Safe.**
- **Body-size limit** — `readBody` enforces `driver.maxRequestBody` (1 MB). **Safe.**
- **`execSync(\`test -x ${b}\`)`** in `drivers/orca/core.ts:400` — `b` comes from the hard-coded array on lines 388/392. **Safe** (smell, but no user input reaches it).
- **`agent-browser` spawn args** — `collect.ts:131`, `eval/queue-collect.ts:83` — all positional args are hard-coded strings (`"eval"`, `"snapshot"`, `"screenshot"`). **Safe.**
- **CSS selector handling** — `body.selector` reaches `page.locator(selector)` / `builder.include(selector)`. Both run inside Chromium's selector engine; no shell or JS escape. Worst case is a ReDoS-style hang in axe / Playwright, which the daemon's per-route timeouts contain. **Accepted.**
- **Ground-truth filename construction** — `eval/queue-init.ts:157` builds filenames from a monotonic `id`, not from data. **Safe.**

---

## Recommended commit order (smallest blast radius first)

1. Validate `$BRANCH` (reject values starting with `-` or containing shell-meta characters) and replace `git checkout "$BRANCH"` with `git switch "$BRANCH"` in `eval/sprite-bootstrap.sh` (#5). **Do not** add `--` to the `git checkout` line — `--` makes git treat the value as a pathspec, which would break the default `main` case.
2. Pass `settleMs` as an arg to `page.evaluate` in `drivers/wait.ts` (#6).
3. Add `--remote-debugging-address=127.0.0.1` to the Chromium launch args (#7).
4. Allow-list URL schemes in `/navigate` (and the CLI `start` / `navigate` paths) (#2).
5. Add `Host` / `Origin` validation middleware to `drivers/server.ts` (#1).
6. Move `/tmp/*` files behind an `O_NOFOLLOW`-aware helper or to a per-user dir, and validate the PID file before `process.kill` (#3, #4).
