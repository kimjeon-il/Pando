# Territorial source provenance and project wire contract

This source-provenance and historical exchange contract originated as a shared Pando Web/PandoEditor agreement. The current product is the single Pando Web Viewer with a C++/WASM document and temporal owner. See [project data ownership](architecture/project-data-ownership.md), [temporal meaning](timeline-contract.md), and current schema owners [`src/runtime/version-contract.js`](../src/runtime/version-contract.js) / [`src/document/timeline-records.js`](../src/document/timeline-records.js).

> **Current wire versions:** project **14**, territorial model **6**, `timelineRecords` **3**. The old project **10** / timeline **1** figures below are a dated migration/fixture snapshot, **not accepted current input**. Preserve original source receipts and test-oracle descriptions; do not use historical migration steps as live code instructions.

## Names

Source `names` and `alternateNames` describe undated names and search terms.
An explicit `nameVersions` array supplies independent name intervals with
`validFrom`, `validTo` and `names`. Each names value has optional `ko` and `en`
objects and a `native` array with explicit language tags. Each language has a
`common` name, a `formal` name, or both, and optional `aliases`. Unknown formal
names, translations and historical dates stay absent. Existing unclassified
search aliases retain their original text.

The shared C++ timeline selects names independently of geometry, using the same
inclusive interval and precision rules. Explicit name gaps are not filled from
another period. Undated catalog browsing presents the latest documented name
edition. Search includes all documented names and aliases; dated results show
the selected edition.

Builtin country name editions compile to the existing `name` property binding.
Its value includes `name`, `nameExplicit` and optional structured `names`.
The resolved names appear in `metadata.nameDetails`; this is a projection of
the same property, not a second timeline. Common-name edits retain formal names,
native entries and aliases through history and exchange. Catalog imports remain
snapshots: they copy the name edition selected at their source reference date.

`build-territorial-entity-chunks.mjs --entities=<ids>` regenerates only those
source chunks and their shared catalog index. `build-builtin-world.mjs
--entities=<ids> --names-only` updates country names while retaining geometry,
geometry validity, relationships and coverage. It rejects any non-name source
change against the pinned original.

## Explicit correction of an invalid current identity

Ordinary entity scopes cannot retire a catalog identity. A confirmed false current
identity uses `--retirement-manifest=<file>` in the existing territorial chunk,
builtin publication and library storage owners. This is a metadata correction,
not a historical dissolution: no retirement date or reassigned past geometry is
created. The contract only admits a single selected geometry version per retired
source, a sole-member lineage without relations, and a paired display subunit.
Incoming source, snapshot, lineage, policy or coverage references block retirement.

The JSON execution manifest has `schemaVersion: 1`,
`kind: "invalid-current-identity"`, `previousIndex`, `stagedIndex`, `worldView`, `displayPolicy`,
`previousBuiltinIndex`, `previousCoverage`, `previousCurrentWorld`,
and a nonempty `sources` array. Every top-level input is a `{path, sha256}` receipt
for preserved original bytes. Each source row contains `entityId` and three such
receipts: `source`, `chunk`, `lineage`. Capture these under the same scoped writer
lease, before changing active files. `previousIndex` is the pinned archival index;
`stagedIndex` is the active generated index, including separately authored source
updates not yet compiled. Their catalog membership, view and lineage metadata
must agree; the retired source entry itself must be unchanged. Chunk retirement
verifies the actual active index against `stagedIndex` and preserves its surviving
descriptors. Storage verifies `previousIndex` against the pinned archive. The indexed gzip hash, decoded source,
projected metadata and lineage must all agree with their recovery copies.

Within the existing write lease, preserve originals, remove only the declared
source/lineage/chunk files, and apply the exact world-selection removal. The
territorial chunk retirement command publishes only the authoring index, using
the planned display policy without activating it. Ordinary selected source
chunk generation can follow. The builtin metadata retirement producer emits only
an in-memory index/coverage baseline; surviving country files and nonretired
compiled source revisions stay unchanged. `buildBuiltinWorldRetiredPartialPublication`
then runs ordinary scoped compilation against this baseline. The equivalent CLI
is `build-builtin-world.mjs --retirement-manifest=<file> --entities=<ids>`.

`writeBuiltinWorldPublication` accepts the same `retirementInputs` and the exact
producer-returned file Map, not a copied or modified map. It verifies the current
runtime baselines, complete current-source compilation, source-derived world
projection and original recovery receipts before writing. Display policy,
current-world, coverage and emitted countries are written under one existing
library write lease, with index last. On a write failure, changed targets are
restored from their exact in-memory old bytes; a restoration failure is reported
as incomplete recovery. A compile failure performs no runtime writes. Authored
source/chunk changes can remain WIP. Old content-addressed payloads remain intact.
This is rollback-safe activation, not a cross-file atomic filesystem operation.
The display-policy loader reads the current file for each publication; a partial
publication shares one policy snapshot across its components.

Final scoped storage supplies the same retirement manifest, exact file prefixes
for all removed and paired files, and explicit `--remove-path` entries for the
three files per retired source. Its guards verify both the source and compiled
cleanup, the original archive receipts, and ordinary historical review gates for
other edits. An advanced source input revision cannot hide behind an unchanged
compiled payload. A whole-prefix scope, extra deletion, changed snapshot, unrelated
view/display change or missing recovery copy does not authorize this correction.
Raw reference datasets and original evidence remain outside the removal scope.

### Original 2026 source/project exchange schema snapshot (historical; not current)

- Web project schemaVersion: **10**; native project version: **10**.
- Territorial identity/model schemaVersion: **6**; timelineRecords: **1**.
- Project `id` identifies an independently editable instance. It is never the
  catalog entity identity or a geometry archive reference.
- `properties.sourceEntityId` (native unit `sourceEntityId`) records the source
  entity ID. `sourceGeometryVersion` records the selected source versionId.
  Both are strings; empty means no catalog provenance.
- GeoPackage derived territorial tables use `source_entity_id` and
  `source_geometry_version`. Embedded project JSON remains authoritative.
- A catalog import copies one selected geometry into new static, unbounded
  project lifetime/binding/parent records. It retains the original lifetime in
  `metadata.sourceLifetime`, geometry validity in `metadata.sourceGeometryValidity`,
  the selection precision/date in `metadata.sourceReferenceDate`, and source
  attribution in `metadata.sourceInfo`.
- An undated import uses the source object's explicit
  `metadata.representativeGeometryVersionId` and records `sourceReferenceDate: null`.
  A dated import selects only a version covering the requested date. The representative
  never supplies a missing historical version or implies a shared world reference date.
- Source IDs/version IDs are preserved. New project instances receive their
  own IDs; existing project IDs and complete geometry archive survive exchange.
- Repeated imports are distinct instances. Source administrative parent links
  may be translated only through an explicitly selected project parent or the
  new objects in the same import batch. They imply no political sovereignty.
- Project save/restore does not require catalog access. Complex timeline projects
  remain storable/exchangeable; static UI activation policy is unchanged.
- Builtin country selections follow the same snapshot boundary: source lifetimes,
  exact geometry validity and version IDs remain in `metadata.historicalTimeline`.
  Unbounded project records describe the imported editable instance, not evidence
  of historical source coverage. Only the builtin viewer reloads source dates.
- Application autosave exports `pandolab-autosave-full`, including all selected
  geometry. It requires neither a calendar-dependent baseline nor catalog access
  on restore. No migration of retired development autosaves is provided.
- Retired project 9, identity 5 and sourceLibraryId/source_library_id are rejected.
  No reader, migration, alias or compatibility fallback is provided.

Fixture oracle changes for this revision are limited to the new schema numbers
and provenance contract. Geometry coordinates, archive identity, temporal
precision and inclusive bounds are not regenerated from codec output.

## Dated parent relations in the builtin baseline

`historical-world/policy.json` may contain bounded `parentRelations` entries:
`{entityId, parentEntityId, validFrom, validTo, basis}`. Both IDs are source
identities; the compiler maps them to builtin IDs and emits the existing
`timelineRecords.parentRelations` records. The rule is applied before parent
availability and peer-overlap calculations. Missing endpoints, self-links,
unbounded intervals, overlapping rules and cycles are rejected.

Use this for an evidenced administrative relationship in a selected baseline
interval. It does not change the source entity's static parent, lineage,
coordinates, geometry validity or lifetime. Outside the specified interval the
original source parent remains effective. Lineage successor relations are not
administrative parent relations. Partial publication includes dated parent
endpoints in its dependency graph and compiles only each component's rules.
