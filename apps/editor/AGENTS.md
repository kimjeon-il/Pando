# Scope: apps/editor — graphical editor development freeze

Follow the repository-root AGENTS.md and docs/branch-policy.md.

- As of 2026-11-02 the interactive, hand-authored GIS editor is in a **new-feature freeze**. Do not add new direct polygon/vertex manipulation, country/coast drawing, snap/draft, or direct-map-edit tool features.
- Do not delete, disable, or silently replace existing editor behavior during E0. The old code remains a reference until the review workflow is adopted and verified.
- Work explicitly requested under E1–E7 (read/review architecture, extraction, cutover, removal and regression) is allowed. Stability/security/data-integrity fixes are allowed if independently tested.
- Preserve C++/WASM read/validation routines, the current supported project format, browser/native file-access contract, Windows/Android identity and exact pinned external data until a targeted change is separately authorized.
- Avoid adding parallel state owners or new editable formats; use existing canonical owners. No deployment or main merge without explicit authorization.
- See [E0 implementation contract](../../docs/development/editor-retirement-e0.md) for per-module inventory, baseline and verification gates.
