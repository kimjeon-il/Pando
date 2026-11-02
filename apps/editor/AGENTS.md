# Scope: apps/editor — Windows read-only reviewer (E7/R2)

Follow repository-root AGENTS.md and docs/branch-policy.md.

- `apps/editor/src-tauri` and the shell tooling are Windows-only. The active UI is the `apps/viewer` Viewer/Review graph, staged as `review.html`.
- Do not add Android or APK builds, NDK alignment flags, native Android resources, signer/ADB flows, or Android acceptance checks. Responsive mobile Web remains supported and must not be removed.
- Do not reactivate graphical editing, geometry drafting/vertex manipulation, editor command IPC, GeoPackage writes or native document transfer in the Windows reviewer.
- Preserve the Viewer shared C++/WASM core, historic dataset pins, read-only document admission, source SHA validation, provenance, correction-draft and diagnostic permissions.
- Do not change the installed Windows application identifier, user profile locations or native-cache layout without a separate migration plan. Never delete existing user profiles or retired Android caches implicitly.
- Keep the native artifact installer limited to Windows signed/source-verified manifests and `pandolab-web-shell.exe`, optional `WebView2Loader.dll` and offline `PandoLab-setup.exe`.
- The archived `apps/editor/frontend` and `apps/editor/templates` sources are not product entrypoints. R3/R4 will address their build hashes and eventual deletion; do not couple them back into Viewer.
- Keep E6/E7/R2 contract tests and real Windows WebView2 verification. Main merges, release deployment and GIS data changes require separate authorization.
