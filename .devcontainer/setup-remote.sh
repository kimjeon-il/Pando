#!/usr/bin/env bash
# This runs only inside a user-created GitHub Codespace, never on the host PC.
set -euo pipefail
cd "$(dirname "$0")/.."
# Select installed Node 24 in this non-login Codespaces shell.
# shellcheck source=.devcontainer/ensure-node.sh
source .devcontainer/ensure-node.sh
if [ "$(printenv CODESPACES || true)" != "true" ]; then
  echo "PANDO_REMOTE_ONLY_CODESPACES_REQUIRED: open the branch in GitHub Codespaces." >&2
  exit 1
fi
expected="$(tr -d '\r\n' < .nvmrc)"
actual="$(node -p "process.versions.node.split('.')[0]")"
if [ "$expected" != "$actual" ]; then
  echo "PANDO_REMOTE_ONLY_NODE_MISMATCH: expected Node $expected, found $actual" >&2
  exit 1
fi
# pnpm and frontend packages are isolated to the remote container.
# No Emscripten, LLVM, MinGW, GDAL, LibTorch or native compiler is provisioned.
bash .devcontainer/pnpm.sh install --frozen-lockfile --ignore-scripts
node scripts/remote-only-doctor.mjs
