# Behavior-preserving Web / App refactor corpus

`manifest.json` records the pre-refactor source pair and SHA-256 of every frozen
input/reference. `baseline-selection.mjs` is the exact Git blob from the recorded
Web commit, retained only as a test oracle. `selection.json` has independently
specified ordered results, including silent anchor updates, duplicated inputs,
pruning, encoded IDs and empty-selection no-ops. Do not regenerate expected values
from the implementation under test.

Run `node tools/check-platform-portability.mjs` for the current Web/shared selection regression.
The retired Qt app registry and probes have been removed. Frozen Web sources remain
inputs to current shared/WASM regression tests; they do not claim app UI parity.
