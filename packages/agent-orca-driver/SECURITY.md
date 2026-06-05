# Security model

This document covers the security posture of `agent-orca-driver` v0.1.0-dev,
and explains why `npm audit` reports advisories that don't matter in this
package's usage.

## Network surface

The HTTP daemon binds to `127.0.0.1:<port>` (port 8001 by default). There
is no opt-in for binding non-loopback today — if you need remote access,
use Codespaces port-forwarding (gated by GitHub auth) or your own
reverse proxy. Inbound requests are gated by:

- **Host allow-list** — `127.0.0.1:<port>`, `localhost:<port>`, and the
  three Codespaces forwarded-URL patterns
  (`<name>.app.github.dev`, `<name>.preview.app.github.dev`,
  `<name>.githubpreview.dev`). Anything else gets `403 bad host`.
- **Origin allow-list** — same set, applied to both HTTP routes and the
  `/live`, `/stream`, `/events` WebSocket upgrade handshakes. Cross-origin
  WebSocket attacks (a malicious page opening `ws://localhost:8001/events`)
  are rejected before the handshake completes.
- **Navigation URL scheme allow-list** — `/navigate` only accepts `http:`,
  `https:`, `data:`. `file:` and `chrome:` are excluded so a compromised
  request can't be turned into a local-file-read primitive.

Outbound traffic the driver itself originates: Chromium's network requests
(driven by `/navigate`), Playwright's CDP channel (loopback only), the
AT-SPI2 D-Bus socket (loopback Unix socket), and the live-view ffmpeg
encoder (reads from the local X display).

## Trust boundary: the page being audited

The daemon assumes the page it's pointed at is one **you** chose. axe-core
runs scripts inside that page during `/audit`, MutationObserver runs there
during `/observe`, AT-SPI2 walks the accessibility tree it exposes, and the
transcript records everything Orca speaks back. Hostile pages can't escape
those into the daemon process, but they CAN try to wedge it via volume —
huge DOMs, runaway mutation churn, multi-megabyte aria-labels, etc.

The daemon defends against the obvious volume cases with hard caps:

- Inbound request bodies are capped at `MAX_REQUEST_BODY` (1 MiB).
- Transcript entries are truncated per-field and the buffer is capped at
  `MAX_TRANSCRIPT_ENTRIES` (10 000); older entries fall off.
- `/audit` truncates each axe `node.html` and the optional aria-snapshot
  tree before serialization, so a single audit response stays bounded.
- `/loading-state` caps each per-element-detail array (`liveRegions`,
  `statusRoles`, `ariaBusyElements`, `loadingIndicators`) at 200 entries
  and stops walking the `*` selector after 50 000 elements visited; the
  reported COUNTS in `summary` still reflect the true totals.
- The AT-SPI2 tree walk in `/item-text` is bounded to 5 000 D-Bus
  round-trips per call on top of the existing per-recursion depth caps,
  so a wide-and-shallow accessibility tree can't pin the daemon.

These caps are belt-and-braces, not a sandbox. **Do not point `/navigate`
at attacker-controlled URLs you wouldn't trust the rest of your toolchain
(browser, axe-core, Playwright) to render.** The HTTP surface is the
trust boundary; the page is not.

### When you need a real sandbox

The caps above assume an honest page that's merely buggy or large. If
your threat model has pages that are *actively hostile* — auditing
arbitrary URLs at scale, running as a hosted service for third parties,
compliance regimes that require per-audit isolation — the right next
step is to run the daemon inside its own container or microVM:

- A throwaway Docker container per audit, with `--network=audit-net`
  restricting egress to the URL being audited; nothing else mounted.
- A Firecracker microVM for stronger boundaries (Chromium 0-day
  exfiltration goes to a fresh VM with no persistent state).

That adds ~10 s of startup per audit and some setup.sh complexity around
running the live-view stack (ffmpeg + X11 + AT-SPI2 + DBus) inside the
inner container, but it lets you trust pages you don't control. The
single-container model that ships today is the right default; the
inner-sandbox upgrade is the right shape for that next step.

## `npm audit` advisories

The package reports 5 advisories from `npm audit`. **All 5 live in one
dependency chain (`dbus-native`) and none of them are exploitable in this
package's threat model.** They appear because `dbus-native` (an unmaintained
but widely-used pure-JS D-Bus client) ships transitive deps that haven't
been patched upstream.

| Advisory | Where it lives | Why it's not exploitable here |
|---|---|---|
| `minimist` ≤ 0.2.3 — prototype pollution (3× critical) | `dbus-native` → `optimist` → `minimist` | Reachable only through `optimist`'s CLI-argv path. `dbus-native` is used as a library; we never feed user input into `optimist.parse()`. The vulnerable code path is not invoked at runtime. |
| `xml2js` < 0.5.0 — prototype pollution (moderate) | `dbus-native` → `xml2js` | Parses D-Bus introspection XML returned by AT-SPI2 (`at-spi2-core`) over a **localhost Unix socket**. For this to bite, an attacker would have to *be* the AT-SPI2 daemon on the same machine, which means they already have local code execution — the prototype pollution is irrelevant in that posture. |
| `put` — sensitive data exposure (low) | `dbus-native` → `put` | Buffer marshalling on the same localhost D-Bus channel; same threat model as `xml2js` — the channel endpoints are the daemon process and AT-SPI2, both controlled. |

`npm audit fix` reports "No fix available" for all three roots, because the
maintained `dbus-native` releases still depend on these versions.

### Why we use `dbus-native` anyway

`dbus-native` is the only pure-JS D-Bus client that works reliably for
AT-SPI2's accessibility-bus protocol. The alternatives:

- **`dbus-next`** — actively maintained, no audit warnings, but uses a
  different API; a swap would touch every AT-SPI2 call site and require
  re-verifying every Orca interaction. Tracked as a future refactor.
- **`node-dbus`** — native bindings, would force a C++ toolchain into
  every `setup` and break the "Node-only ship target" goal.

The trade-off `agent-orca-driver` makes today: take the audit noise, keep
the install simple, document why the warnings don't apply in this usage.

### When to revisit

The threat-model analysis above relies on the network surface staying
loopback-only. If a future change exposes the daemon process to untrusted
callers in a way that lets them feed data into the AT-SPI2 channel, or if
the allow-list is widened beyond Codespaces forwarded URLs, this analysis
must be redone. The swap to `dbus-next` becomes worthwhile if either:

1. The audit warnings start blocking a downstream consumer's CI gate.
2. A new advisory lands in a `dbus-native` dep that's *not* in this safe
   set (e.g. an RCE in the D-Bus parser itself, not in a CLI arg parser
   we never call).

## Reporting

For genuine security issues, contact the maintainers via the
`estern1011/a11y-auditor` repo's security advisory channel.
