#!/usr/bin/env bash
#
# Bootstrap a sprites.dev environment for running a11y-auditor evaluations.
#
# Usage (from the host, with the repo already cloned locally):
#
#   sprite create <name> --skip-console
#   cat eval/sprite-bootstrap.sh | sprite exec -s <name> -- bash -s -- [branch]
#
# Or if the repo is public:
#   sprite exec -s <name> -- bash -c "$(curl -fsSL https://raw.githubusercontent.com/estern1011/a11y-auditor/main/eval/sprite-bootstrap.sh)" -- [branch]
#
# Arguments:
#   branch  Git branch or ref to check out (default: main).
#           Pass your current branch to evaluate unpushed changes.

set -euo pipefail

BRANCH="${1:-main}"
DEST="$HOME/a11y-auditor"

case "$BRANCH" in
  -*|*[![:alnum:]/._-]*)
    echo "invalid branch name: $BRANCH" >&2
    exit 1
    ;;
esac

echo "==> Installing bun..."
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

echo "==> Cloning a11y-auditor (branch: $BRANCH)..."
if [ -d "$DEST" ]; then
  echo "    Repo already exists, fetching and checking out $BRANCH..."
  cd "$DEST"
  git fetch origin
  git switch "$BRANCH"
  git pull origin "$BRANCH" || true
else
  git clone --branch "$BRANCH" https://github.com/estern1011/a11y-auditor.git "$DEST"
  cd "$DEST"
fi

echo "==> Installing Orca driver system dependencies..."
sudo bash drivers/orca/setup.sh

echo "==> Installing npm dependencies..."
bun install

echo "==> Installing Playwright Chromium..."
bunx playwright install --with-deps chromium

echo "==> Installing agent-browser..."
npm i -g agent-browser

# Make bun, agent-browser, and node globals available in future shells
NODE_GLOBAL_BIN="$(npm root -g)/../bin"
{
  echo ""
  echo "# Added by a11y-auditor bootstrap"
  echo "export PATH=\"\$HOME/.bun/bin:$NODE_GLOBAL_BIN:\$PATH\""
} >> "$HOME/.bashrc"

echo ""
echo "==> Bootstrap complete (branch: $BRANCH, commit: $(git rev-parse --short HEAD))."
echo ""
echo "Test it:"
echo "  sprite exec -s <name> --dir $DEST -- bun drivers/orca/driver.ts start https://example.com"
