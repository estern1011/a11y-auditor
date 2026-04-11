#!/usr/bin/env bash
#
# Setup script for running orca-driver in headless/remote Linux environments
# (GitHub Codespaces, Docker containers, CI, cloud VMs).
#
# Installs: xvfb, Orca, AT-SPI2, xdotool, Python GI bindings.
# Usage:
#   sudo bash orca-setup.sh          # install packages
#   bash orca-setup.sh check         # verify everything works
#   bash orca-setup.sh start-env     # start xvfb + dbus + at-spi2 (for containers without systemd)

set -euo pipefail

# ---------------------------------------------------------------------------
# Package installation
# ---------------------------------------------------------------------------

install_packages() {
  echo "==> Installing Orca driver dependencies..."

  export DEBIAN_FRONTEND=noninteractive

  apt-get update -qq

  apt-get install -y -qq \
    orca \
    xvfb \
    xdotool \
    at-spi2-core \
    dbus-x11 \
    libatk-adaptor \
    espeak-ng \
    speech-dispatcher \
    pulseaudio \
    libnspr4 \
    libnss3 \
    openbox \
    > /dev/null

  echo "==> Packages installed."
}

# ---------------------------------------------------------------------------
# Start virtual display + accessibility bus (for containers without systemd)
# ---------------------------------------------------------------------------

start_env() {
  # Unset NO_AT_BRIDGE — many Docker images set this, which disables AT-SPI2
  if [ -n "${NO_AT_BRIDGE:-}" ]; then
    echo "==> Unsetting NO_AT_BRIDGE (was blocking AT-SPI2 bridge)"
    unset NO_AT_BRIDGE
  fi

  # Start D-Bus session bus if not already running
  if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
    echo "==> Starting D-Bus session bus..."
    eval "$(dbus-launch --sh-syntax)"
    export DBUS_SESSION_BUS_ADDRESS
    echo "    DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"
  else
    echo "==> D-Bus already running: $DBUS_SESSION_BUS_ADDRESS"
  fi

  # Start Xvfb if no display is available
  if [ -z "${DISPLAY:-}" ]; then
    echo "==> Starting Xvfb on :99..."
    Xvfb :99 -screen 0 1280x1024x24 -ac &
    XVFB_PID=$!
    export DISPLAY=:99
    echo "    DISPLAY=$DISPLAY (PID: $XVFB_PID)"
    sleep 1
  else
    echo "==> Display already available: $DISPLAY"
  fi

  # Start PulseAudio with null sink (Orca/speech-dispatcher needs an audio backend)
  echo "==> Starting PulseAudio (null sink)..."
  pulseaudio --check 2>/dev/null || pulseaudio --start --exit-idle-time=-1 2>/dev/null
  pactl load-module module-null-sink sink_name=dummy 2>/dev/null || true
  echo "    PulseAudio ready."

  # Start AT-SPI2 registry daemon
  # AT-SPI2 uses its own separate bus, launched via at-spi-bus-launcher
  echo "==> Starting AT-SPI2 bus..."
  /usr/libexec/at-spi-bus-launcher &>/dev/null &
  sleep 1
  /usr/libexec/at-spi2-registryd &>/dev/null &
  sleep 1
  echo "    AT-SPI2 bus started."

  # Export for child processes
  echo ""
  echo "Environment ready. Export these in your shell:"
  echo "  export DISPLAY=$DISPLAY"
  echo "  export DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"
  echo ""
  echo "Then run: bun orca-driver.ts start <url>"
}

# ---------------------------------------------------------------------------
# Verify installation
# ---------------------------------------------------------------------------

check() {
  local ok=true

  echo "Checking orca-driver prerequisites..."
  echo ""

  # Check commands
  for cmd in orca xvfb-run xdotool openbox dbus-launch; do
    if command -v "$cmd" &>/dev/null; then
      echo "  [OK] $cmd: $(command -v "$cmd")"
    else
      echo "  [MISSING] $cmd"
      ok=false
    fi
  done

  # Check D-Bus
  if [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
    echo "  [OK] DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"
  else
    echo "  [WARN] DBUS_SESSION_BUS_ADDRESS not set (run: start-env)"
  fi

  # Check display
  if [ -n "${DISPLAY:-}" ]; then
    echo "  [OK] DISPLAY=$DISPLAY"
  else
    echo "  [WARN] DISPLAY not set (run: start-env, or use xvfb-run)"
  fi

  # Check bun
  if command -v bun &>/dev/null; then
    echo "  [OK] bun: $(bun --version)"
  else
    echo "  [MISSING] bun"
    ok=false
  fi

  echo ""
  if $ok; then
    echo "All prerequisites met."
  else
    echo "Some prerequisites missing. Run: sudo bash orca-setup.sh"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

case "${1:-install}" in
  install)    install_packages ;;
  check)      check ;;
  start-env)  start_env ;;
  *)
    echo "Usage: orca-setup.sh [install|check|start-env]"
    exit 1
    ;;
esac
