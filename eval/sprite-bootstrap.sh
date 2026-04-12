#!/usr/bin/env bash
#
# Bootstrap a sprites.dev environment for running a11y-auditor evaluations.
#
# Usage:
#   sprite create <name> --skip-console
#   sprite exec -s <name> -- bash eval/sprite-bootstrap.sh [branch]
#
# Arguments:
#   branch  Git branch or ref to check out (default: main).
#           Pass your current branch to evaluate unpushed changes.
#
# Or from the host if the repo isn't on the sprite yet:
#   sprite exec -s <name> -- bash -c "$(curl -fsSL https://raw.githubusercontent.com/estern1011/a11y-auditor/main/eval/sprite-bootstrap.sh)"

set -euo pipefail

BRANCH="${1:-main}"

echo "==> Installing bun..."
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

echo "==> Cloning a11y-auditor (branch: $BRANCH)..."
if [ -d /root/a11y-auditor ]; then
  echo "    Repo already exists, fetching and checking out $BRANCH..."
  cd /root/a11y-auditor
  git fetch origin
  git checkout "$BRANCH"
  git pull origin "$BRANCH" || true
else
  git clone --branch "$BRANCH" https://github.com/estern1011/a11y-auditor.git /root/a11y-auditor
  cd /root/a11y-auditor
fi

echo "==> Installing Orca driver system dependencies..."
bash drivers/orca/setup.sh

echo "==> Installing npm dependencies..."
bun install

echo "==> Installing Playwright Chromium + agent-browser..."
bunx playwright install --with-deps chromium

echo ""
echo "==> Bootstrap complete (branch: $BRANCH, commit: $(git rev-parse --short HEAD))."
echo ""
echo "Test it:"
echo "  sprite exec -s <name> --dir /root/a11y-auditor -- bun drivers/orca/driver.ts start https://example.com"
