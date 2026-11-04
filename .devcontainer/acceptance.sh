#!/usr/bin/env bash
# Run only inside the actual Codespaces container, never on the PC.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$(printenv CODESPACES || true)" != "true" ] || [ -z "$(printenv CODESPACE_NAME || true)" ]; then
  echo "PANDO_CODESPACES_REQUIRED: open work/remote-only in a real Codespace." >&2
  exit 1
fi
node scripts/remote-only-doctor.mjs
# Chromium, not an SDK/compilation tool, is installed in this remote container.
bash .devcontainer/pnpm.sh exec playwright install --with-deps chromium
bash .devcontainer/pnpm.sh exec playwright test --config playwright.codespaces.config.js
