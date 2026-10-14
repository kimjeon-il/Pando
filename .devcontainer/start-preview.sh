#!/usr/bin/env bash
# Start a private forwarded branch preview. No package install or deployment.
set -euo pipefail
if curl --silent --fail --max-time 2 http://127.0.0.1:4173/__p3_health >/dev/null 2>&1; then
  echo 'P3 preview server is already running on port 4173.'
  exit 0
fi
log="${TMPDIR:-/tmp}/pando-p3-preview.log"
nohup node scripts/p3-preview-server.mjs >"$log" 2>&1 </dev/null &
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --silent --fail --max-time 2 http://127.0.0.1:4173/__p3_health >/dev/null 2>&1; then
    echo 'P3 branch preview available via Codespaces port 4173 (private).'
    exit 0
  fi
  sleep 0.5
done
echo 'P3 branch preview failed to start:' >&2
cat "$log" >&2
exit 1
