# Territorial source provenance and project wire contract

This contract is shared by Pando Web and PandoEditor. The temporal semantics in
`docs/timeline-contract.md` are unchanged.

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
