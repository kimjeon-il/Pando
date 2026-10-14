#!/usr/bin/env bash
# Capture an actual Qt Quick window, not a black Xvfb root framebuffer.
# Exit nonzero if the QML smoke check fails or the screenshot is blank.
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
command -v xdotool
command -v import
command -v identify
xvfb-run -a -s '-screen 0 1280x800x24' bash -c '
  set -euo pipefail
  app="$1"; log="$2"; screenshot="$3"
  export QT_QPA_PLATFORM=xcb QT_QUICK_BACKEND=software
  "$app" --smoke-check > "$log" 2>&1 &
  pid=$!
  valid=0
  for attempt in $(seq 1 30); do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    window=$(xdotool search --onlyvisible --pid "$pid" 2>/dev/null | head -1 || true)
    if [ -z "$window" ]; then
      window=$(xdotool search --onlyvisible --name "Pandoeditor" 2>/dev/null | head -1 || true)
    fi
    if [ -n "$window" ]; then
      import -window "$window" "$screenshot" 2>/dev/null || true
      if [ -s "$screenshot" ]; then
        colors=$(identify -format "%k" "$screenshot" 2>/dev/null || echo 0)
        if [ "$colors" -ge 8 ] 2>/dev/null; then valid=1; break; fi
      fi
    fi
    sleep 0.07
  done
  wait "$pid"
  if [ "$valid" -ne 1 ]; then
    echo "P3_QT_SCREENSHOT_BLANK_OR_WINDOW_NOT_FOUND" >&2
    exit 3
  fi
  echo "Captured nonblank Qt Quick window: $screenshot"
' bash "$app" "$log" "$screenshot"
