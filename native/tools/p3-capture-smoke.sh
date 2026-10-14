#!/usr/bin/env bash
# Ask Qt Quick to grab its actual rendered window while it still exists.
set -euo pipefail
if [ "$#" -ne 3 ]; then
  echo "Usage: p3-capture-smoke.sh APP_BINARY LOG_PATH PNG_PATH" >&2
  exit 2
fi
app="$(realpath "$1")"
log="$(realpath -m "$2")"
screenshot="$(realpath -m "$3")"
test -x "$app"
mkdir -p "$(dirname "$log")" "$(dirname "$screenshot")"
command -v identify >/dev/null

set +e
QT_QPA_PLATFORM=xcb QT_QUICK_BACKEND=software \
  xvfb-run -a -s '-screen 0 1280x800x24' \
  "$app" --smoke-check "--smoke-capture=$screenshot" >"$log" 2>&1
status=$?
set -e
cat "$log"
if [ "$status" -ne 0 ]; then
  echo "P3_QT_SMOKE_FAILED: status=$status" >&2
  exit "$status"
fi
test -s "$screenshot" || { echo 'P3_QT_CAPTURE_MISSING' >&2; exit 3; }
colors="$(identify -format '%k' "$screenshot")"
width="$(identify -format '%w' "$screenshot")"
height="$(identify -format '%h' "$screenshot")"
if [ "$colors" -lt 8 ] || [ "$width" -lt 160 ] || [ "$height" -lt 120 ]; then
  echo "P3_QT_CAPTURE_BLANK: $width x $height colors=$colors" >&2
  exit 3
fi
echo "P3_QT_CAPTURE_OK: $width x $height colors=$colors"
