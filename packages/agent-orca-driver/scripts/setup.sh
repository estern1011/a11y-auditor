#!/usr/bin/env bash
#
# One-command provisioner for agent-orca-driver in a fresh Linux container
# (Codespaces, Docker, CI runners, cloud VMs).
#
# Installs the OS packages Orca + the daemon + the live-view pipeline need,
# then the Playwright Chromium browser binary. The apt step runs via sudo
# internally; the Playwright browser install runs as the invoking user so
# the binary lands in that user's cache (~/.cache/ms-playwright) — the same
# user that later runs `agent-orca-driver start`.
#
# Idempotent: re-running is safe. apt skips already-installed packages and
# `playwright install` skips an already-downloaded browser.
#
# Usage:
#   agent-orca-driver setup           # preferred entrypoint
#   bash scripts/setup.sh             # direct invocation

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve paths
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Pick a sudo prefix only when not already root.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "==> Not root and sudo not found — apt install may fail." >&2
  fi
fi

# Resolve the Playwright CLI: prefer the package's local install so the
# browser version matches the pinned dependency; fall back to npx.
playwright() {
  if [ -x "$PKG_ROOT/node_modules/.bin/playwright" ]; then
    "$PKG_ROOT/node_modules/.bin/playwright" "$@"
  else
    npx --yes playwright "$@"
  fi
}

# ---------------------------------------------------------------------------
# OS packages
# ---------------------------------------------------------------------------

install_packages() {
  echo "==> Installing OS packages (apt)..."
  export DEBIAN_FRONTEND=noninteractive

  $SUDO apt-get update -qq

  # orca/xvfb/xdotool/at-spi2/dbus/atk: the screen-reader + accessibility bus
  # espeak-ng/speech-dispatcher/pulseaudio: speech backend Orca speaks through
  # openbox: window manager so xdotool window-focus works
  # ffmpeg: encodes the Xvfb framebuffer for the /live stream (Day 3)
  # libnss3/libnspr4: Chromium runtime deps
  $SUDO apt-get install -y --no-install-recommends \
    orca \
    xvfb \
    xdotool \
    at-spi2-core \
    dbus-x11 \
    libatk-adaptor \
    espeak-ng \
    speech-dispatcher \
    pulseaudio \
    openbox \
    ffmpeg \
    libnss3 \
    libnspr4

  echo "==> OS packages installed."
}

# ---------------------------------------------------------------------------
# Chromium (Playwright)
# ---------------------------------------------------------------------------

install_chromium() {
  # OS-level deps for Chromium go through sudo (apt); the browser binary
  # itself is fetched as the invoking user so it lands in ~/.cache.
  echo "==> Installing Chromium OS dependencies (Playwright)..."
  if [ -n "$SUDO" ]; then
    $SUDO env "PATH=$PATH" bash -c "cd '$PKG_ROOT' && \
      { [ -x node_modules/.bin/playwright ] && node_modules/.bin/playwright install-deps chromium || npx --yes playwright install-deps chromium; }" \
      || echo "    (install-deps reported issues — continuing; curated apt list may already cover them)"
  fi

  echo "==> Downloading Chromium browser binary (user cache)..."
  playwright install chromium

  echo "==> Chromium ready."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  install_packages
  install_chromium
  echo ""
  echo "Setup complete. Verify with:  agent-orca-driver doctor"
  echo "Then start the daemon with:   agent-orca-driver start <url>"
}

main "$@"
