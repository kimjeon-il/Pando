# Browser-only review staging (legacy test helper)

The independent Windows Tauri/Rust reviewer, Android application, and graphical editor are retired. Their packaging, icons and local native preflight are not product entrypoints.

The remaining `apps/editor/stage.mjs`, `check-stage.mjs`, data fixture helpers and their tests are **Viewer support utilities**: they verify current Web Viewer asset closure, read-only source/provenance rules and optional review evidence. Do not remove them just because of the directory name.

The current product is `apps/viewer/` and its integrated review panel (`?inspect=1`, `?debug=1`, `Ctrl+Shift+.`). Existing PC installs and user profile data are untouched; retired sources remain available in Git history.
