#!/usr/bin/env bash
# Run only inside the actual Codespaces container, never on the PC.
set -euo pipefail
cd "$(dirname "$0")/.."
# Select installed Node 24 in this non-login Codespaces shell.
# shellcheck source=.devcontainer/ensure-node.sh
source .devcontainer/ensure-node.sh
if [ "$(printenv CODESPACES || true)" != "true" ] || [ -z "$(printenv CODESPACE_NAME || true)" ]; then
  echo "PANDO_CODESPACES_REQUIRED: open work/remote-only in a real Codespace." >&2
  exit 1
fi
node scripts/remote-only-doctor.mjs
# Start the actual Codespaces development server before installing a browser.
# Never substitute the Playwright fixture server or report a passing empty port.
bash .devcontainer/start-preview.sh
health="http://127.0.0.1:4173/__shell/health"
log="/tmp/pando-remote-only-preview.log"
pid_file="/tmp/pando-remote-only-preview.pid"
ready=0
for attempt in $(seq 1 240); do
  reply="$(curl --silent --fail --max-time 3 "$health" 2>/dev/null || true)"
  if [[ "$reply" == *'"product":"viewer"'* && "$reply" == *'"executionMode":"development"'* ]]; then
    if [[ "$reply" != *'"error":null'* ]]; then
      echo "PANDO_CODESPACES_PREVIEW_ERROR: development server rejected a source refresh: $reply" >&2
      if [ -f "$log" ]; then tail -n 80 "$log" >&2; fi
      exit 1
    fi
    ready=1
    break
  fi
  if [ -f "$pid_file" ]; then
    pid="$(cat "$pid_file")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && ! kill -0 "$pid" 2>/dev/null; then
      echo "PANDO_CODESPACES_PREVIEW_EXITED: development server exited before opening port 4173." >&2
      if [ -f "$log" ]; then tail -n 80 "$log" >&2; fi
      exit 1
    fi
  fi
  if (( attempt % 20 == 0 )); then
    echo "Pando Codespaces Viewer is still preparing pinned geographic assets; waiting for the live development server..."
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "PANDO_CODESPACES_PREVIEW_NOT_READY: no live viewer development server on 127.0.0.1:4173." >&2
  if [ -f "$log" ]; then tail -n 80 "$log" >&2; fi
  echo "Inspect the log above; do not run Playwright against a stopped or fixture server." >&2
  exit 1
fi
echo "PANDO_CODESPACES_PREVIEW_READY: actual Viewer development server responds on 4173."
# Chromium, not an SDK/compilation tool, is installed in this remote container.
bash .devcontainer/pnpm.sh exec playwright install --with-deps chromium
bash .devcontainer/pnpm.sh exec playwright test --config playwright.codespaces.config.js
