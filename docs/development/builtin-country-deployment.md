# Independent country publication — phase 3

## Scope

The existing work/gis branch owns this change. No main integration, Pages deployment,
installer release, source geography edits or archived data deletion is authorized.
Web and App select exactly the same current builtin country assets; orphan files,
old transports and oversized original streams are not deployment dependencies.
The existing source data, names, flags, parent links and complete country gzip hashes
are preserved by the one-time publication conversion.

## Physical files

`src/data/builtin-country-files.js` is the shared physical-file
contract for the generator, loader and both product asset collectors.
`storageLayout: country-files-v1` and payload schema 2 remain current. No transport
or offset is accepted by runtime or deployment consumers.

A country with at most 512 KiB of stored bytes uses its existing content-addressed
`countries/<id>-sha256-<hash>.json.gz`. An oversized country keeps that descriptor
as its complete content identity, and owns an ordered `parts` array. Each part is
an independently hashed `country-parts/sha256-<hash>.bin` of at most 512 KiB, with
identity encoding and equal compressed/decoded lengths. Only those parts, not the
oversized original, are emitted/deployed. Concatenation reconstructs ONE country's
original gzip bytes, never a world bundle. The reader verifies every part and the
complete country hash/length before gzip decoding and schema validation.

`tools/data/builtin-country-bytes.mjs` owns generation finalization and the Node reader.
Partial generation emits only changed countries/parts and metadata. The loader
keeps immutable part caches and reads parts sequentially inside a country slot,
so the existing six-request ceiling and month supersession rules remain intact.
The App verification fixture uses this same finalizer rather than a separate packer.

## One-time conversion and exact storage

Run from the existing Pando work/gis workspace with its pinned data prepared:

```sh
node tools/data/builtin-country-storage.mjs --prepare
node tools/data/builtin-country-storage.mjs --prepare --apply
node tools/data/builtin-country-storage.mjs --verify
node tools/data/builtin-country-storage.mjs --store --push
```

Preparation reads only oversized original country streams, splits them without
recompression, removes transport offsets from the index and preserves all complete
country hashes. Small files are not reread or rewritten by preparation. Verification
checks individual files, reconstructed country streams, decoded sizes and identities.
The initial conversion verifies all countries; ordinary scoped storage verifies only
changed country descriptors. Storage compares against the exact current paired pin
and delegates only the index, changed physical files and changed coverage diagnostics
to the existing library-data owner. It does not run tests or GIS regeneration in the
data repository, broaden to all assets/data, delete unhydrated data or publish main.
The resulting archived bytes are verified against their working input hashes.

After an approved country source edit, use the existing scoped generators and this
storage owner. Do not call the aggregate build:map-assets recipe or broad archive
prefixes merely to update a country name. Source generation and separate mesh work
retain their existing explicit dependency rules.

## Verification and activation

The branch-only Independent country deployment contracts workflow executes focused
unit contracts, the App file-stage/fixture readers, actual Web/App asset closures,
real dated country loads and one Chromium calendar/historical loading regression.
It first creates a local paired data pin. The integration check compares every
unselected archive entry and all original complete-country hashes against the prior
pin. Only after those checks pass can explicit workflow input `activate=true` or an
intentional `[activate-country-files]` commit publish the exact saved scope and
advance config/library-data.json on work/gis. The code branch compare-and-swap and
ordinary fast-forward data push refuse concurrent updates; no force push is used.
A failed check never advances the remote code pin. A post-publication conflict leaves
the data commit preserved rather than replacing newer code.

The 512 KiB limit is a product transfer contract, not a promise about all API response
limits. Large editable source JSONs, territorial-library chunks and unrelated render,
terrain or water resources are outside this builtin transfer cap. Remote editing of
large sources should submit scoped instructions/tools and perform generation in the
Pando runner, not send whole source files or all output bytes through chat. Existing
pinned archive history is retained; obsolete one-off migration callers and archived
aggregate cleanup belong to phase 4. Do not mistake absence from deployment for
physical deletion of historical assets.

Review: implementation receives author self-review; no independent reviewer is
available in the chat execution environment. Native binaries/Android installers are
not rebuilt by this storage-only phase.
