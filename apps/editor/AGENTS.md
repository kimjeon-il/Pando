# Scope: apps/editor — browser-only review staging and regression fixtures

Follow the repository-root AGENTS.md and docs/branch-policy.md.

- The sole product is apps/viewer/ (desktop and mobile Web). The Tauri/Rust Windows reviewer, Android native application and graphical editor are retired; do not rebuild their entrypoints or packages.
- Retain apps/editor/stage.mjs, check-stage.mjs, read-only fixture helpers and their relevant tests while consumed by Viewer source-closure, provenance, security, staging or CI contracts. The directory name does not make them independent application code.
- Keep the canonical Viewer review panel, diagnostic capture, SHA-256 checks, source admission and read-only boundaries; do not duplicate Core, Worker, GIS or rendering logic here.
- Do not recreate native IPC, file transfers, GeoPackage writes, shell CSP/config, Windows installers or Android acceptance checks.
- Existing local installations and user profiles must never be deleted or migrated implicitly. Obsolete source remains recoverable from Git history.
- Do not merge into main, publish Web Pages or change historical GIS data without separate authorization.
