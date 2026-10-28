# Two-lake history implementation plan

**Goal:** Apply the approved Caspian and Aral display shapes for 1922-01-01 through 1929-12-31, inclusive, in the existing web/editor map.

**Architecture:** Library `geometryVersions` remain the date source. The common C++ schema-3 resolver selects independent `hydroBuiltin` objects. PhysicalResources only composes their existing immutable presentation assets; it does not select dates itself. Both selected historical water objects reference one coherent derived land mask.

**Approval:** User confirmed the 1922–1929 display interval on 2026-10-27. This is a display policy, not a claim about measured shoreline validity. Parent approved this narrow implementation and rejected parallel/legacy timeline mechanisms.

## Constraints
- Preserve lake lifetimes, modern source geometry, original reconstructed masters and island holes.
- Reuse the already published Caspian display derivative after tracing its approved source; do not retrace or simplify again.
- Aral uses the approved Prasolov-1926 display candidate, not the earlier Times/NE draft.
- Do not subtract lakes from national territory. Only the physical presentation land mask changes.
- Preserve existing north/south Aral identities outside the approved historical binding. During a ready selected historical binding, replace their presentation by explicit ObjectRef references, not names or date fallbacks.
- No main integration, deployment, portable package or unrelated full validation.

## Tasks
- [x] Restore approved archives and check source hashes, source dates and display derivation.
- [x] Reuse the permanent work/gis worktree and inspect current main/work/gis canonical owners.
- [x] Reproduce the multiple-selected-water failure with small synthetic fixtures.
- [x] Extend the existing physical resource owner, preserving independently selected object identity and a single coherent land asset.
- [x] Add a pure library-version-to-catalog projection validated by the common C++ timeline owner; no alternate date selector.
- [x] Verify delayed admission races, copied-water and visibility independence, exact interval boundaries, failures and reentry.
- [x] Update only the two lake sources/chunks/index entries and related physical assets through scoped library writes.
- [x] Verify unchanged national geometries, preserved modern bytes, Aral local mask differences, island holes and source replacement behavior.
- [x] Review the final diff and remote concurrency before asking parent to commit/push.

## Alternatives rejected
Combining lakes into one identity would break independent editing. A new context/time table is unnecessary because the two selected historical versions share the same land asset. Generalizing the old Caspian-only date generator would duplicate the new common timeline owner. Library insertion alone would not apply the requested change to the default map.

## Review focus
Pending admission after a date switch; immutable context reuse after visibility changes; copied-object fill ownership; source suppression only after successful load; no inferred lake formation/end dates.
