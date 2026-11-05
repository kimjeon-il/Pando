#!/usr/bin/env bash
# Optional Codespaces smoke check. Heavy browser regression belongs to Actions.
# An actual Codespace browser acceptance is still available via --browser.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=.devcontainer/ensure-node.sh
source .devcontainer/ensure-node.sh
mode="${1:---smoke}"
if (( $# > 1 )) || [[ "$mode" != "--smoke" && "$mode" != "--browser" ]]; then
  echo "Usage: bash .devcontainer/acceptance.sh [--smoke|--browser]" >&2
  exit 2
fi
if [[ "$(printenv CODESPACES || true)" != "true" || -z "$(printenv CODESPACE_NAME || true)" ]]; then
  echo "PANDO_CODESPACES_REQUIRED: open work/remote-only in a real Codespace." >&2
  exit 1
fi
# Start only after the operator requests inspection; this performs the first
# dependency installation only if node_modules/esbuild does not exist.
bash .devcontainer/start-preview.sh
node scripts/remote-only-doctor.mjs
health="http://127.0.0.1:4173/__shell/health"
log="/tmp/pando-remote-only-preview.log"
pid_file="/tmp/pando-remote-only-preview.pid"
ready=0
for attempt in $(seq 1 240); do
  reply="$(curl --silent --fail --max-time 3 "$health" 2>/dev/null || true)"
  if [[ "$reply" == *'"product":"viewer"'* && "$reply" == *'"executionMode":"development"'* ]]; then
    if [[ "$reply" != *'"error":null'* ]]; then
      echo "PANDO_CODESPACES_PREVIEW_ERROR: development server rejected a source refresh: $reply" >&2
      if [[ -f "$log" ]]; then tail -n 80 "$log" >&2; fi
      exit 1
    fi
    ready=1
    break
  fi
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && ! kill -0 "$pid" 2>/dev/null; then
      echo "PANDO_CODESPACES_PREVIEW_EXITED: development server exited before opening port 4173." >&2
      if [[ -f "$log" ]]; then tail -n 80 "$log" >&2; fi
      exit 1
    fi
  fi
  if (( attempt % 20 == 0 )); then
    echo "Pando Codespaces Viewer is preparing pinned geographic assets..."
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "PANDO_CODESPACES_PREVIEW_NOT_READY: no live viewer on 127.0.0.1:4173." >&2
  if [[ -f "$log" ]]; then tail -n 80 "$log" >&2; fi
  exit 1
fi
echo "PANDO_CODESPACES_PREVIEW_READY: actual Viewer development server responds on 4173."
# This read-only HTTP smoke requires no Chromium installation or local native SDK.
node --input-type=module - <<'NODE'
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:4173';
const paths=['/assets/wasm/pandoeditor-core.wasm','/assets/data/world/current.json','/config/library-data.json'];
const results=await Promise.all(paths.map(path=>fetch(origin+path)));
assert.equal(results[0].status,200,'WASM must be served');
const wasm=new Uint8Array(await results[0].arrayBuffer());
assert.deepEqual([...wasm.subarray(0,8)],[0,97,115,109,1,0,0,0],'WASM magic/version');
assert.equal(results[1].status,200,'Pinned world manifest must be served');
const world=await results[1].json();
assert.ok(world?.assets&&typeof world.assets==='object','Pinned world assets required');
assert.equal(results[2].status,404,'Private library configuration must not be exposed');
console.log('PANDO_CODESPACES_SMOKE_PASS '+JSON.stringify({wasmBytes:wasm.length,worldAssets:Object.keys(world.assets).length}));
NODE
if [[ "$mode" == "--browser" ]]; then
  # Expensive and user-initiated only. Normal regression belongs to Actions.
  bash .devcontainer/pnpm.sh exec playwright install --with-deps chromium
  bash .devcontainer/pnpm.sh exec playwright test --config playwright.codespaces.config.js
fi
