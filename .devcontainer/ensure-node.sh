#!/usr/bin/env bash
# Source from Codespaces lifecycle scripts. Select an installed Node 24 runtime,
# never install Node, an SDK, a compiler, or any host dependency.
pando_ensure_node() {
  local expected actual nvm_path existing_nvm
  expected="$(tr -d '\r\n' < .nvmrc)"
  if [ "$expected" != 24 ]; then
    echo "PANDO_CODESPACES_NODE_PIN_UNEXPECTED: .nvmrc must pin Node 24." >&2
    return 1
  fi
  if command -v node >/dev/null 2>&1; then
    actual="$(node -p "process.versions.node.split('.')[0]")"
    if [ "$actual" = "$expected" ]; then return 0; fi
  fi
  existing_nvm="$(printenv NVM_DIR || true)"
  for nvm_path in "$existing_nvm/nvm.sh" /usr/local/share/nvm/nvm.sh "$HOME/.nvm/nvm.sh"; do
    if [ ! -f "$nvm_path" ]; then continue; fi
    export NVM_DIR="$(dirname "$nvm_path")"
    # nvm use selects only an already installed version; it never downloads.
    # shellcheck disable=SC1090
    . "$nvm_path" --no-use
    if command -v nvm >/dev/null 2>&1; then
      nvm use --silent "$expected" >/dev/null 2>&1 || true
    fi
    if command -v node >/dev/null 2>&1; then break; fi
  done
  if ! command -v node >/dev/null 2>&1; then
    echo "PANDO_CODESPACES_NODE_MISSING: Node.js 24 is not available in this Codespace." >&2
    echo "In VS Code, press Ctrl+Shift+P, select 'Codespaces: Rebuild Container'." >&2
    echo "The pinned image is mcr.microsoft.com/devcontainers/javascript-node:24-bookworm." >&2
    echo "If Codespaces is in recovery mode, inspect its creation log." >&2
    return 1
  fi
  actual="$(node -p "process.versions.node.split('.')[0]")"
  if [ "$actual" != "$expected" ]; then
    echo "PANDO_REMOTE_ONLY_NODE_MISMATCH: expected Node $expected, found $actual." >&2
    echo "Rebuild the Codespace with its pinned Node 24 development container." >&2
    return 1
  fi
}
pando_ensure_node
