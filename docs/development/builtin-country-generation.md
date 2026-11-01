# Independent country generation — phase 1

## Scope and rollout boundary

This implements the approved generation phase only: country-scoped outputs,
small indexes and delta-only updates. The existing loader, browser cache, Web/App
asset plans and library data pin are deliberately unchanged. Do not publish a newly
generated independent index to the currently packed runtime. Phases 2 and 3 must
switch those consumers before a new paired runtime revision is activated. No main
merge, deployment, source geography/name/flag edits or historical-data deletion is
part of this phase.

## Generation contract

`tools/build-builtin-world.mjs` remains the canonical publication owner.
`index.json` retains payload schema 2 and declares `storageLayout: country-files-v1`.
Country paths are `countries/<entity>-sha256-<hash>.json.gz`, with `encoding`,
`sha256`, `compressedBytes`, `decodedBytes` and country coverage in the index.
There is no `transport` descriptor, `offset`, aggregate project or aggregate binary.
The template remains an empty scene template, not a world coordinate store.

Full generation produces every country plus the index and coverage diagnostics.
Partial generation returns only changed/new country bytes plus the index
and, for geometry work, coverage diagnostics. Descriptors for unaffected countries
are reused; their source and payload files are not read, decoded, recompressed or
written. Connected hierarchy/spatial dependencies are still recomputed by the
existing compiler. Identical regenerated payloads are omitted from the delta.
Name-only generation reads just each selected prior country to preserve geometry
and rejects non-name source changes. No-op names emit no country bytes.

`finalizeBuiltinWorldFiles(index, files, {previousIndex})` validates emitted bytes
and references. An omitted payload is allowed only when the prior verified index
pins the same country/path/hash/encoding/lengths. Unknown output paths and missing
or altered new payloads fail before writing. It never reads country files itself.
Both full and partial builders return `Map<relative path, Buffer>`; partial maps
are deltas, not self-contained copies of every country. Apply them over the exact
previous publication. Consumers needing all bytes must resolve the unchanged
references against that publication, not assume they are in the returned map.

`writeBuiltinWorldPublication` writes payloads and diagnostics before the index,
skips byte-identical writes, and retains files needed by other pins. It does not
remove archived packed assets. This ordering is not a replacement for the paired
revision/atomic activation required in the later deployment phase.
The obsolete `--pack-existing` command fails explicitly rather than silently
falling through to full regeneration. All generation callers use the same finalizer;
there is no compatibility path that rebuilds a transport file.

## Focused verification

Run only the directly related generation/catalog contracts:

```sh
node --test tests/unit/builtin-country-publication.test.mjs tests/unit/historical-world-publication.test.mjs tests/unit/builtin-world-catalog.test.mjs
```

The branch-scoped, read-only `Builtin country publication contracts` workflow
mounts the existing paired runtime for the real compiler and runs these three
suites. It does not regenerate or push library data, change the pin or deploy.
Coverage includes deterministic independent output, exact hashes/lengths,
unrelated source/payload read exclusion, unchanged bytes/mtime, selected name-only
geometry preservation, no-op output, missing/corrupt references, old metadata
removal, hierarchy/overlap propagation and preserved unselected provenance.
