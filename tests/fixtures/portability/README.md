# Behavior-preserving Web / App refactor corpus

`manifest.json` records the pre-refactor source pair and SHA-256 of every frozen
input/reference. `baseline-selection.mjs` is the exact Git blob from the recorded
Web commit, retained only as a test oracle. `selection.json` has independently
specified ordered results, including silent anchor updates, duplicated inputs,
pruning, encoded IDs and empty-selection no-ops. Do not regenerate expected values
from the implementation under test.

Run `node tools/check-platform-portability.mjs [absolute-selection_probe-path]`
from the Web repository. Without the native executable the report explicitly says
`crossPlatformVerified: false`. With it, the existing native production-state probe
executes all inputs and every output field is compared exactly. This verifies the
selection contract only, not complete application parity.

Existing timeline record/storage fixtures and their native comparison tools remain
the authoritative timeline corpus. Existing geometry, exchange and UI tests remain
the authoritative contracts for those workflows; none is replaced by this corpus.

Native consumers pin the Web commit and bytes in their portability manifest. The
new pin supplements historical oracles; it must never rewrite their source pins.
