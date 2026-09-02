# Versioning, migrations, and exchange contracts

## Version ownership

- `package.json` is the only editable source for the app version.
- `assets/js/build-meta.js` and asset query revisions are generated build metadata, not release version sources.
- Project schema, model schema, dataset versions, and build/cache revisions are independent from the app version.
- Shared schema numbers live in `assets/js/modules/version-contract.js`.

## App version policy

The app uses `0.MINOR.PATCH` while it remains pre-1.0.

Use a **MINOR** increment for a user-visible feature, UX-system change, architecture contract change, or save-format capability change. Use a **PATCH** increment for a bug fix, visual polish, performance improvement without a contract change, or an internal refactor that does not change a public/runtime contract.

A commit does not require a version bump by itself. Release version changes are made at release checkpoints, then `pnpm generate:build-meta` regenerates deployment metadata.

## Project schema

Current project schema: **4**. Minimum automatic migration source: **3**.

Project files are loaded through the migration-aware schema gate. Migrations must be sequential and explicit:

```text
v3 -> migrateProjectV3ToV4 -> v4
```

A migration must clone the input, preserve stable IDs where possible, preserve unsupported source data under provenance `details`, update exactly one schema version, and never silently skip a missing migration step. Files newer than the runtime or older than the supported migration floor fail with an explicit migration error.

### v3 -> v4

The v4 migration:

- normalizes legacy country editor fields into canonical country properties and sparse overrides;
- converts Generic Feature v1 into Generic Feature v2;
- preserves legacy Generic semantics and unknown properties in Source/Provenance details;
- accepts a legacy `drawings` collection as Generic fallback input when present;
- renames `drawings` / `userDrawings` presentation aliases to `genericFeatures`;
- writes the `lossless-fallback` land-object contract.

## Import/export contract

Object meaning and exchange format are separate concerns. Canonical exchange targets are registered in `exchange-adapter-registry.js`:

```text
project
country
t e r r i t o r y
administrative
region
distribution
generic
```

(`territory` above is the literal target; spacing in this document is not part of the identifier.)

Each target has one descriptor with a domain and can provide `importPayload` and/or `exportPayload`. Import services dispatch non-country targets through this registry instead of adding new top-level `if/switch` branches. Country import remains a specialized pipeline because identity resolution, overlap analysis, and merge policy are transactional operations rather than simple materialization.

Generic is explicitly marked as a fallback target. Identifiable data should be routed to a formal territorial, distribution, hydro, or label domain before Generic is considered.

## Adding a migration

When the project schema changes:

1. increment `PROJECT_SCHEMA_VERSION` in `version-contract.js`;
2. add exactly one `N -> N+1` function to `PROJECT_MIGRATIONS`;
3. add losslessness and rejection tests;
4. update the serializer contract;
5. keep `MIN_SUPPORTED_PROJECT_SCHEMA_VERSION` unchanged unless support is intentionally dropped;
6. run `pnpm check:versioning` and `pnpm test`.

Do not add schema-conversion conditionals to feature UI, renderer, or persistence call sites.
