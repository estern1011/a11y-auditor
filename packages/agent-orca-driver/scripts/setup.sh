#!/usr/bin/env bash
#
# Placeholder. The full provisioner (apt + xvfb + dbus + at-spi2 +
# pulseaudio + ffmpeg + Playwright Chromium) lands in the Day-2 slice — see
# docs/agent-orca-driver-plan.md §11 day 2 + §6 setup-script outline.
#
# Until then, use the v1 provisioner from the parent monorepo:
#   sudo bash ../../drivers/orca/setup.sh

set -euo pipefail

echo "agent-orca-driver setup is not yet implemented in this slice." >&2
echo "Run the v1 provisioner from the parent monorepo for now:" >&2
echo "  sudo bash ../../drivers/orca/setup.sh" >&2
exit 2
