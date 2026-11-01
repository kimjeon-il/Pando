# Builtin country separation — phase 4

Scope: permanent work/gis only, based on code 410bfa0 and data 2b5c061.
No main merge, live deployment, native rebuild, geographic changes or archive deletion.

The residual audit found the completed common-country wire migration still called
by water preparation, five real-data tests reading descriptor.file directly, a
Pages fixture publishing the retired layout, and an editor restore test blocking
only the obsolete transport URL. The archive materializer also restored every
archived builtin file, including the retired aggregate and oversized originals.

Ruling: separate the runtime dependency view from the complete archive index.
Only a country-files-v1 catalog uses this filter. Read and validate its small pinned
index; select its exact physical country/part files and coverage diagnostics.
Missing or contradictory live pins are fatal. Do not download retired payloads.
The complete archive and previous Git history remain unchanged. Broad storage
must not interpret deliberately unhydrated historical files as deletions.
Existing private cached work is still preserved; this is not cache garbage collection.
Explicit restoration of an older pin remains available for the one-time conversion,
but the current viewer and deployment consumers still reject the retired layout.

Remove the water command's completed all-country migration, preserving its water
processing and report shape with zero changed country files. Route real-data tests
through the shared verified per-country reader, including bounded parts. Update
fixtures and restore-request guards, not geographic expectations. The December
parent-link assertion uses the existing schema-3 objectRef rather than entityId.
Negative tests which reject transport/offset and the explicit --pack-existing error
are intentional guards, not legacy execution paths; retain them.

Verification is restricted to residual/materialization contracts, affected dated
readers with a test-only old-file read guard, selected archive storage/Pages/App
contracts, and the changed editor restore browser scenario. Do not repeat the
previous phase's unchanged full loading or geography suites. Review is author
self-review; no independent reviewer or native execution is claimed.

Red evidence: af0fd323 reproduces the water migration dependency. At 3499cee5,
preparation fails when the archived aggregate is unavailable even though all
current country parts exist. The historical-pin restore case still passes.
Final execution results are recorded by the branch CI and completion response.
