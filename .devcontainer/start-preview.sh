#!/usr/bin/env bash
# Start the read-only private web preview in Codespaces. Never deploy Pages.
set -euo pipefail
cd "$(dirname "$0")/.."
# Select installed Node 24 in this non-login Codespaces shell.
# shellcheck source=.devcontainer/ensure-node.sh
source .devcontainer/ensure-node.sh
# Accept only the live viewer development process, not a fixture server.
health="http://127.0.0.1:4173/__shell/health"
if curl --silent --fail --max-time 2 "$health" | grep -Fq '"executionMode":"development"'; then
  echo "Pando remote preview already listening on private port 4173."
  exit 0
fi
temp_root="$(node -p "require('node:os').tmpdir()")"
log="$temp_root/pando-remote-only-preview.log"
pid_file="$temp_root/pando-remote-only-preview.pid"
if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  echo "Existing Pando preview may still be preparing assets (PID $(cat "$pid_file")). Acceptance will verify port 4173. Log: $log"
  exit 0
fi
nohup node scripts/p3-preview-server.mjs >"$log" 2>&1 </dev/null &
pid="$!"
printf '%s\n' "$pid" > "$pid_file"
for attempt in $(seq 1 15); do
  if curl --silent --fail --max-time 2 "$health" | grep -Fq '"executionMode":"development"'; then
    echo "Pando private Codespaces preview ready on port 4173."
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "PANDO_REMOTE_PREVIEW_FAILED: see $log" >&2
    cat "$log" >&2
    exit 1
  fi
  sleep 1
done
# Pinned geographic materialization can take longer than port startup checks.
echo "Pando preview is still preparing pinned assets (PID $pid). Readiness must be checked before tests. Log: $log"
