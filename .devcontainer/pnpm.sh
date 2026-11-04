#!/usr/bin/env bash
# Pinned pnpm without touching a host machine or requiring global installation.
set -euo pipefail
cd "$(dirname "$0")/.."
# Select installed Node 24 in this non-login Codespaces shell.
# shellcheck source=.devcontainer/ensure-node.sh
source .devcontainer/ensure-node.sh
pinned="$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")"
if command -v pnpm >/dev/null 2>&1 && [ "$(pnpm --version)" = "$pinned" ]; then
  exec pnpm "$@"
fi
exec npm exec --yes --package="pnpm@$pinned" -- pnpm "$@"
