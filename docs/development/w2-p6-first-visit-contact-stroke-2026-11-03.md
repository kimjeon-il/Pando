# W2-P6 first-visit contact and WASM stroke optimization — 2026-11-03

Source: `integration/r4-gis-w2-20261103`. No `main` merge or deployment.

## Scope

The preceding Stage 2 implemented root-level hierarchy caching and a two-date packet LRU. This follow-up addresses the *cache miss* path when the destination date's geometry/contact relations have changed: `boundaryState.replace`/contact reconciliation, and `boundaryAssembleStrokePacket` across all ~74k stroke segments.

Changes already on the integration branch:

- `country-contact-row-pruning.js` conservatively selects prepared source rows that may contribute to the candidate contact pairs; `country-contact-core.js` still calls the verified C++ `countryContactPairsBatch` and restores original source references. `verifyContactParity` runs the full, unpruned C++ path as a CI-only witness and compares every decoded contact/owner/source-reference result.
- `country-stroke-group-reuse.js` reuses compiled C++ stroke chunks only when owner grouping, **ordered Float64 coordinate values**, and quality match. The full native assembler remains the authoritative implementation of chaining, seam splitting, subdivision and dash phase. Reassembled owner ranges and GPU buffers are checked by regression tests. A 24MiB group-fragment retention budget is separate from the 96MiB two-date packet LRU.
- Worker profiling now separates `contact-remove`, `contact-neighbor-search`, `contact-select-source`, `contact-encode`, `contact-native-bridge`, `contact-decode`, `contact-merge`, and group assembly/reuse spans. These spans are opt-in and must not be summed when nested.
- `tests/browser/viewer-temporal-boundary-worker-rollback.spec.mjs` was corrected to treat the Viewer initial reveal's **labels** phase as a settled terminal state (alongside `complete`); this does not weaken document-hash, GPU pixel, rollback generation, or error injection assertions. The prior failure was a 30-second timeout waiting for the wrong reveal state.

## Evidence — real 1991-12 ↔ 1992-12 Viewer

From [CI #41591076324](https://github.com/kimjeon-il/Pando/actions/runs/41591076324), source `61a72350af1fe8fce429e4968a33bfcbde2bf11c`, Linux Playwright Chromium. **The full CI run failed** on the rollback test's settled-label condition; the separate history profile and packet reuse tests passed. These are individual measurements, not controlled hardware A/B medians.

1991→1992 (first miss in this run):

| Measured stage | Observed |
| --- | ---: |
| Worker state update (includes CI parity witness) | 1355.9ms |
| Full-input parity witness **only in CI** | 1179.0ms |
| Contact source rows: original → selected | 113921 → 6300 |
| Contact native bridge | 88.6ms |
| Contact decode | 6.2ms |
| Worker packet preparation | 262.1ms |
| Contact stroke native bridge | 31.1ms |
| Stroke group reuse | 312/324 groups, 72215 source segments |
| Stroke native input | 1763 segments |

1992→1991 (existing packet cache hit): state update 65.5ms; contact source 103128 → 1781; native contact bridge 23.7ms; packet preparation 6.4ms. 1991→1992 again (packet hit): state update 185ms; packet 4.9ms. The CI parity witness accounts for the anomalous 1355.9ms initial state-update value; it is **not** production cost. A rough subtraction yields ~176.9ms, not a separately timed production measurement.

Original 1991/1992 document SHA-256 values from prior stage are retained:
- 1991-12 `c0c64d689152e19406628e0820bcb4a2de8c87755ec07d96d4a495bcd7980b59`
- 1992-12 `a32202fc4ecfdd800d3819384779f1b547898da4c9ff815fef964285134a377f`

## Validation gates and limits

The targeted unit test suite on source `61a72350...` passed, while the browser suite had 2 passes and one rollback-test timeout due to `data-initial-reveal=labels` never becoming `complete`. A test-only fix is committed at `c0f2f64de75e526bab1a1e61b75c6d1477c91b10`; **the rerun must pass before declaring the entire follow-up complete**.

The first-visit WASM bridge spans include JS↔WASM marshaling; they are not a pure C++ CPU profile. Contact pruning is conservative but must retain full-input parity on complex coastline, multi-owner and dateline fixtures. No actual GTX1650 A/B/A2 p50, GPU memory/heap soak, or end-to-end first-visit speedup has been established. Existing source/data pins remain unchanged.
