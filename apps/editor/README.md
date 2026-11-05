# Browser-only review staging (legacy test helper)
The separate Windows Tauri/Rust reviewer is retired on `work/remote-only`.
No Windows installer, Cargo manifest, Tauri CLI, native producer, artifact
fetch command or Windows build workflow remains in this branch.
`apps/editor/stage.mjs`, `check-stage.mjs` and their fixture tests remain
only to verify the current Web Viewer does not load retired editor assets.
This is not a standalone app. Use `?inspect=1` or `Ctrl+Shift+.` in Viewer.
Existing PC binaries are untouched; old sources remain in Git history.
