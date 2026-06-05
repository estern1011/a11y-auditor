# Security model

This document covers the security posture of `agent-orca-driver` v0.1.0-dev,
and explains why `npm audit` reports advisories that don't matter in this
package's usage.

## Network surface

The HTTP daemon binds to `127.0.0.1:<port>` by default (port 8001). Any
non-loopback bind must pass `--port 0.0.0.0:<port>` explicitly. Inbound
requests are gated by:

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
loopback-only (or, in non-loopback mode, gated by `--auth-token` — Day-3
work). If a future change exposes the daemon process to untrusted callers
in a way that lets them feed data into the AT-SPI2 channel, or if the
allow-list is widened beyond Codespaces forwarded URLs, this analysis
must be redone. The swap to `dbus-next` becomes worthwhile if either:

1. The audit warnings start blocking a downstream consumer's CI gate.
2. A new advisory lands in a `dbus-native` dep that's *not* in this safe
   set (e.g. an RCE in the D-Bus parser itself, not in a CLI arg parser
   we never call).

## Reporting

For genuine security issues, contact the maintainers via the
`estern1011/a11y-auditor` repo's security advisory channel.
