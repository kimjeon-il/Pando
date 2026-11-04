#!/usr/bin/env bash
# Pinned pnpm without touching a host machine or requiring global installation.
set -euo pipefail
cd "$(dirname "$0")/.."
pinned="$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")"
if command -v pnpm >/dev/null 2>&1 && [ "$(pnpm --version)" = "$pinned" ]; then
  exec pnpm "$@"
fi
exec npm exec --yes --package="pnpm@$pinned" -- pnpm "$@"
