# Map Toolkit native source closure and explicit baseline transition

## Intent and constraints
Restore six mandatory native source resources omitted by the private package's duplicated source list. Preserve the existing plugin, private audience, model, data pairing, native binaries, WASM, all prior payloads, both manifests and retained extras. Keep the normal Git-ancestry requirement. No reset, deletion of old work, synthetic merge, force push, installed-cache edits or public deployment.

The old local GIS branch and index are preserved under a named archive ref and metadata-only worktree. The canonical permanent GIS worktree starts at its current remote head. The running developer-source tree remains untouched.

## Approaches
A synthetic ancestry merge or disabling the ancestor guard could conceal omitted prior work and is rejected. Requiring restoration of remote history would prevent the authorized repair. The selected approach is a separately requested, fail-closed, content-equivalence transition tied to the exact authenticated current account release. This is an engineering choice within the user's explicit workspace/release-baseline reconciliation approval.

## Design
The ordinary prepare flow retains `assertReleaseAncestor`. An explicit `--rebaseline-archive` plus `--archive-release` selects the narrow native-source repair transition. No saved proof or caller-supplied pass boolean is accepted. Preparation re-reads the complete supplied current-release archive and derives proof afresh from authenticated Plugin Creator snapshots and two immutable producer candidates.

The validator requires:
- Original private USER plugin identity, exact current release ID and complete inventory. All archive regular-file paths and sizes must match that inventory, with no duplicates, missing or additional files.
- Archived root manifest, compatibility manifest and old release receipt must match their separately read authenticated texts. Old receipt schema, version, code/data/model identities and content fingerprint must agree with actual payload.
- Old and proposed immutable candidates must have equal existing normalized payload fingerprints. Independently validate root-manifest configuration and preserve the compatibility manifest wholesale except its version. Existing runtime projection may omit source-only package.json scripts, but generated runtime package.json, lock and dependency pins remain exact.
- Account payload to corrected old candidate may differ only by exactly six fixed native source additions and their matching runtime.json rows. Every preexisting runtime catalogue row and payload byte remains exact. Catalogue order, other fields, duplicate paths and extra additions are checked explicitly. The format uses an expanded seed, not a nested ZIP.
- Preserve every non-owned extra byte. Bind a full inventory hash, both manifest hashes, old receipt hash, plugin/release identity, old/new commits, allowed branch, producer hash and candidate content hash. Store account-specific evidence outside app Git; fixtures are synthetic.

The proof is derived in prepare, bound to the plan and recorded in the new release receipt. Retry recomputes evidence. Upload still uses `expected_release_id`. Readback requires the exact resulting full inventory, both manifests, transition receipt and every payload/extra hash. A changed concurrent release rejects the update. Later normal releases again require ancestry from the newly recorded commit. This transition only accepts the known six-file omission, not a general-purpose ancestry exception.

The existing producer currently rewrites compatibility-interface values from the root manifest. A migration-only preservation option is necessary because the current compatibility prompts contain literal Unicode escapes. Preserve those values exactly, rather than silently correcting unrelated metadata.

## Verification
Keep focused real source-closure and existing release tests. Add synthetic positive/negative transition tests: exact repair accepted; absent, stale, replayed or tampered evidence, wrong plugin/release/commit/branch, changed manifests/receipt/model/data/WASM/native/dependency bytes, seventh/missing/deleted source, duplicate or altered catalogue row, changed extras and upload races rejected. Verify all three actual native artifacts against a fixture populated from the real collected sources. Run source/developer and packaged analyze/revise/export separately; an uploaded account release is not proof of installed-cache refresh.

## Final production and archive gates
Archive decoding rejects duplicate normalized names and symlink, hardlink, device, FIFO or other special entries before constructing a Map; only regular files and safe ordinary directories are accepted. Control characters in member names are rejected. Type/path checks apply to both tar.gz and ZIP input.

Candidate comparison is byte-level for every entry, with only root plugin version and runtime catalog codeRevision normalized; nested plugin files and all other payload fields remain exact. The existing fingerprint is an additional binding, not the sole comparison. After the producer rebuilds the final package, verify its actual files and complete inventory against the proved candidate before upload, allowing only the intended outer version, exact preserved legacy manifest and newly derived receipt. Recompute actual archive fingerprint and protected entry hashes before upload and during readback. This closes artifact-change races between proof generation and final packaging.
