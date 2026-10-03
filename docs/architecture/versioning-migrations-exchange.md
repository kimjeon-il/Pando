# Versioning, project storage, and exchange contracts

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

Current project schema: **8**. Territorial model and Feature schema: **4**.
Temporal relationship schema: **3**. Layer presentation schema remains **4**.

The current schema gate validates the format, model contracts, entity fields,
and references before replacement. Older development schemas and the retired
split collections are rejected; there is no migration reader or compatibility
alias. Loading never overwrites the original project file.

Features share `territorialEntities` and use `entityKind: general | regional`.
General roots and children have the same model, identity and ID-only API; their
hierarchy is derived from `parentId`. Regional entities have no parent or stored
country association and preserve independent geometry through general annexation.
Each Feature owns its geometry and metadata. Missing references, duplicate IDs,
invalid parents, cycles and locked descendant root changes fail validation.
The serialized model header declares `kinds: ['general', 'regional']`; retired
`types` metadata is rejected. See [the common contract](territorial-entity-contract.md).

Full projects and full autosaves serialize `territorialEntities`. Base-data
autosaves serialize `entityDelta: { changed, removedIds }`, including metadata
changes and the application's base classification. Undo snapshots use the same
collection and geometry snapshot pool. Store is the only runtime writer;
replacement and multi-entity changes validate before publication.

Dataset files, preview geometry, and GPU mesh formats keep their existing asset
contracts. Source adapters produce common Features when data enters the model;
display geometry is not written into canonical project storage. Worker input
uses the common entity collection once and derives operation-specific lists.

## Import/export contract

Object meaning and exchange format are separate concerns. Canonical exchange targets are registered in `exchange-adapter-registry.js`:

```text
project
general
regional
distribution
generic
```

Each target has one descriptor with a domain and can provide `importPayload`
and/or `exportPayload`. General and regional GIS rows use the same validated
transaction and current `entities` / `regions` tables. General roots and children
share `entities`; `parent_id` describes hierarchy. No retired country import
identity or merge-policy UI remains. A general import can map a parent; regional
imports remain independent. An optional coast reference controls shape
reconciliation without becoming an administrative association. Generation and
revision checks prevent a pending import from modifying a replaced or edited
project. History and publication occur after all validation succeeds.

Historical source-library territory replacement keeps its topology planner:
replacement of existing root territory is a distinct operation from importing
new GIS objects. Natural Earth names, static country mesh IDs, place-country
references and flag-asset table names retain their dataset meanings. Presentation
categories `countries/subunits/regions` are derived root/child/independent filters,
not entity kinds or split canonical storage.

Generic is explicitly marked as a fallback target. Identifiable data should be routed to a formal territorial, distribution, hydro, or label domain before Generic is considered.

## Changing the project contract

When the project schema changes:

1. increment `PROJECT_SCHEMA_VERSION` in `version-contract.js`;
2. update the current schema gate and common model contract;
3. update full save, autosave, restoration, Undo, and Worker input together;
4. update exchange adapters and directly affected callers;
5. remove obsolete formats and APIs rather than retaining parallel readers;
6. run relevant schema, storage, and workflow checks. Do not run unrelated full
   suites by default.

A migration is added only when the user explicitly requires compatibility with
a specific format. Do not add schema-conversion conditionals to feature UI,
renderer, or persistence call sites.
