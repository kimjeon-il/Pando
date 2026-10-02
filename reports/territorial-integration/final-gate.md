# Territorial entity integration gate

## Ownership and call-path findings

The accompanying generated JSON/Markdown inventories every recognized production
country collection, unit collection and country override access, including local
destructuring, returned/getter aliases and mutations of shared elements.
Each entry names its exact file/function/line, read or write route, canonical owner
and reason. No entire application module is exempted.

| Actual command path | Finding and disposition |
| --- | --- |
| GIS assembly → GIS committer → append/replace | Removed its independently constructed raw-state Store fallback. The production Store is required; GIS/atomic-import tests inject the real Store. |
| Single country/unit deletion → common removal policy | Removed raw-state fallback and unit-only forwarding export. Mandatory Store owns physical removal; relation/label/distribution cleanup stays in the policy. |
| Multi-selection → requestBatchDelete → common removal policy | Country IDs and injected Store were missing. Country and unit deletion now use the same lock/child policy and Store. Cancel, changed locks/children and rollback are covered with real Store/Repository composition. |
| Country creation/conversion/library → createCountryFeature | Factory no longer writes global color overrides before commit. Geometry is detached; generic-to-country color is published by the owning transaction. |
| Region redraw → local preview applyResult | Replaced a mutation through territorialUnitById with a Store collection replacement. Drawing/preview/history flow is unchanged. |
| Reset/load/history → Store.replaceCollections | Reset publishes country/unit/override collections together. History override normalization no longer assigns raw storage. |
| Label copy → History.restoreEditable → geometry invalidation | Persistent dataset delta IDs were mistaken for changes in this Undo. Only changed/added/removed geometry references invalidate country rendering; persistent delta bookkeeping remains unchanged. |
| View/task identity → country color/name/flag | Country overrides now come from Store, not raw state. |
| Domain assembly → Store.onCountriesReplaced → country reindex | This exact callback retains the necessary physical collection assignment; reindexCountries is its geometry/index normalizer. Other domain assembly functions have no raw-write allowance. |
| Repository consumers → hierarchy projection | Removed administrative-prefixed forwarding aliases and sovereign/list query aliases; current consumers use children/parent/siblings/ancestors/descendants/root/administrativeCountry. Stored sovereignId is unchanged. |

## Retained, active boundaries

- Rendering, spatial-index preparation and Worker inputs read explicit snapshots.
  They do not publish document mutations.
- Serializer, decoder and import preparation build detached DTOs before validated
  Store publication. The GeoPackage worker deletes countriesData only from its
  freshly spread settings copy.
- Existing project migrations are called by current validation and implement the
  documented minimum schema-3 to current schema-6 contract. They mutate cloned
  input, not live storage. Removing this active format support would change the
  requested preserved input contract, so it is not treated as a temporary Store
  compatibility adapter. No migration, alias or compatibility wrapper was added.
- The Repository's explicit read-provider constructor is an active pure projection
  seam used by validation fixtures. Production injects the canonical Store; this
  seam does not create or own another mutable Store.
- Generic conversion metadata preserves source properties. It is not discarded
  merely because its helper includes the word legacy.

## Gate and analysis limits

`pnpm check:territorial-storage` parses all production JavaScript with ESLint AST,
resolves scoped local aliases and known Store/Repository lookup returns, and fails
unclassified functions or writes in read-only functions. The Store contract unit
test and permanent Application Architecture CI invoke the same checker. Previous
report-only `|| true` raw audits are removed.

This is not an arbitrary inter-module JavaScript proof. Parameter mutation and
dynamic calls also require the caller/owner review above and behavioral contracts.
In particular the country reindex normalizer receives its collection from the
Store-owned callback; renderer callbacks receive read-only scene inputs. New
owners/access categories require explicit policy review, not a broad file exception.

Core scenarios reuse Store identity/atomic conversion, territorial service,
interaction policy, project history/persistence/restore and typed selection tests.
Additional regressions exercise the actual mixed country/unit batch command and
the actual history snapshot owner. Browser validation remains limited to delete
UI, place copy/Undo/reselection and the changed GIS round-trip.

No schema/history/app version/map data/CSS changes are part of this gate. Temporary
CI/branch removal, main merge and deployment remain separate integration actions.
