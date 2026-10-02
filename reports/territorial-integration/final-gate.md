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
CI/branch cleanup is recorded below; published integration commits are retained.

## Place browser evidence and limitation

- The original default-WebGL case repeatedly timed out on bundled headless
  Chromium/Linux CI, at different operations (editor tab, Undo evaluation or
  restored-row click). Its CPU trace was dominated by native `(program)` time,
  not a single failing Place computation. This is not reported as a fixed GPU
  stall or a proven shader-specific root cause.
- With unchanged assertions, real default-WebGL Edge completed the entire case
  in 17.6 seconds. Bundled Chromium on the existing production Canvas backend
  completed it in 17.0 seconds. The fixture now explicitly selects that supported
  backend to verify Place/History contracts without software-WebGL throughput.
  It still uses the real Place Worker, actual DOM clicks, copy/history/selection
  owners and the restored result; there is no force click, added wait, timeout
  increase, production stub or removed assertion.
- The separate production fix avoids repatching persistently dirty countries for
  label-only Undo. Its regression verifies unchanged geometry does not invalidate,
  while real geometry Undo does. It alone did not eliminate the default-headless
  WebGL timeout; investigating GPU throughput remains outside this entity gate.
- Full local unit result: 1,148 passed, zero failed. Lint, JS syntax, application
  architecture, UI contracts, classified Store audit and diff checks passed.
  Delete UI (wide/compact/mobile and both themes), Edge Place and real GIS
  GeoJSON export/reimport were the only browser cases run.
- The Windows UI layering checker now normalizes checked-out CRLF bundle line
  endings just as the generator already normalizes sources. CSS content/order
  validation remains strict; no CSS inputs or generated bundle were changed.

## Final cleanup

- PR #72 was merged into main. PR #73 was a validation-only PR and is closed;
  its temporary base branch `tmp/territorial-entity-ci-base` is deleted.
- Both retired TEMP verification workflows are disabled. Their historic run
  evidence is retained; no TEMP workflow file remains in the current tree.
- Application Architecture owns the permanent storage audit and full unit gate.
  Its redundant per-file JavaScript path entries, separate focused Store unit
  step and duplicate regex checks are removed. The classified AST audit and
  behavioral boundary tests remain enforced. Full unit tests run once there.
- Regular workflows support manual dispatch, so final verification does not
  require a temporary base branch or validation PR.
- Presentation/service forwarding aliases for geometry transactions and relation
  validation are removed. Conversion and snapshot restoration consume the
  canonical territorial-units functions directly through runtime capability ports.
  These functions use the existing territorial validation group and explicit
  consumer declarations; the twelve-member capability limit remains unchanged.
- Store owns physical writes; Repository owns derived reads/indexes. Documentation,
  error names and test descriptions now distinguish these responsibilities.
- Active project schema migrations and detached validation providers are retained
  for the explicit current contracts described above. No compatibility API is added.
- Broad country/subunit function consolidation remains a separate follow-up audit.
