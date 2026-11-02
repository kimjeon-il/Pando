# W2-P4-3 — Windows GPU first-transition final causal analysis

Date 2026-11-02 Asia/Seoul. **Status: analysis complete; do not adopt the 1MiB upload-step setting in the product. Next priority: previous-packet synchronous Worker contention.** The new priority is an investigation/controlled experiment, not a verified production optimization.

## Evidence pins and scope

- Source Pando fe8282ba32761ab9586348d1712e11cc1f4e7882.
- Data identity data-f50b7f480c812df6f5ea0c40f5461ab0; library pin 5eb7be55208efaafe39bd5a65ec2f111d70b9053.
- Actual Windows GTX 1650 driver 32.0.16.1088, Chromium 151.0.7922.34, ANGLE D3D11 WebGL2, compositing active, 1280x800, map canvas 1280x752 DPR1.
- Published 308-file evidence: kimjeon-il/PandoLab-library-data@3e63d665f70972902a68008e0d14ec26a2506bad, reports/development/performance/w2-p4-2-windows-gpu-2026-11-02/. Read README.md, p4-analysis.json, early-analysis.json, interim-analysis-overlap.json and final-audit.json.
- Main repository W2-P4-2 reproduction docs: docs/development/w2-p4-2-windows-gpu-2026-11-02.md at work/ui commit 7e9f70b09a6749fbab6aca61c1ae4adfa8cbe78b.
- A/B/A2 compare: only a test-specific gpu-upload-scheduler job.step ceiling changed, 256KiB / 1MiB / 256KiB. Shared total frame budgets, correctness gates and data pins were kept. This is not a product implementation.
- n10 newly launched Chromium processes for each cold arm; n20 warmed transitions separately. W2-P4-2 also measured untraced cases, Worker transport, input, memory, and early stage instrumentation. Interim analysis overlapped some A/B measurements for 5.598 seconds and may have affected latency.

## Cold user-visible and GPU-stage results

| Metric | A 256KiB | B 1MiB | A2 256KiB |
| --- | ---: | ---: | ---: |
| First presented p50 | 2198.8ms | 2813.4ms | 2230.3ms |
| First presented p90 | 2468.4ms | 3284.6ms | 2447.6ms |
| First max | 2805.4ms | 3776.9ms | 2451.4ms |
| First >2500ms | 1/10 | 8/10 | 0/10 |
| Worker-cache-hit cold count | 6 | 8 | 9 |
| Main-renderer reuse, no Worker request | 4 | 2 | 1 |
| Cache-hit cold presented p50, separately recalculated | 2247.0ms (n6) | 2880.7ms (n8) | 2246.9ms (n9) |
| Worker receive -> boundary publish p50, hit only | 375.7ms | 112.0ms | 378.1ms |
| GPU scheduler frames, hit only | 23 | 7 | 23 |
| GL bufferSubData bytes | 5426656 | 5426656 | 5426656 |
| Warm presented p50 (separate samples) | 945.4ms | 793.5ms | 812.2ms |

The B local boundary stage improved 263.7ms (70.2%), but overall first presented p50 worsened 614.6ms (27.9%) relative to A and 583.1ms relative to A2. Do not add per-stage medians or confuse conditional-hit cohorts with the entire cold 10 samples.

The same 5,426,656 uploaded bytes consist of 3,008,160 instances and 2,418,496 nodes. GL bufferData calls remained 2; bufferSubData calls 22 / 11 / 22. Recorded GL API CPU invocation totals were ~0.9 / 0.6 / 0.7ms; GPU device execution time was NOT measured. Scheduler step maxima were ~7.6-8.0ms. Increasing step size may affect input responsiveness and is not safe by default.

## Direct Worker listener contention (strongest newly confirmed causal link)

| Cache-hit cold group | A n6 | B n8 | A2 n9 |
| --- | ---: | ---: | ---: |
| Main post returned -> Worker listener entered p50 | 0.045ms | 817.035ms | 0.043ms |
| Overlap with previous synchronous packet preparation p50 | not observed | 816.700ms | not observed |
| Samples with such overlap | 0/6 | 8/8 | 0/9 |
| First Worker event.data access p50 | 243.3ms | 249.1ms | 235.8ms |
| First main event.data access p50 | 60.2ms | 57.5ms | 57.9ms |

Every B hit observation had a previous packet calculation on the **same Worker thread** overlapping almost all the time until the new listener entered (individual overlap 701.4-1358.4ms). A Worker executing synchronous JavaScript/C++ WASM cannot enter the next onmessage until its current call yields/returns. This strongly explains the immediate queue wait. B cache-hit cold presented p50 ~2880.7ms vs A2 ~2246.9ms (633.8ms difference) even though B published the new GPU packet faster.

**Crucial limitation:** why only B had 8/8 such overlaps remains unproven. Startup ordering, trace analysis load, scheduling and Worker completion may have differed between arms. These results prove the queue-wait mechanism and packet-upload micro improvement, NOT that increasing GPU upload budget caused the older Worker task nor a portable 27.9% product slowdown.

The shared-boundary Worker has cooperative yields and latestSequence checks around heavyweight preparation. However prepareCountrySharedBoundaryPacket, prepareStrokePacket, native stroke assembly and JS prepared instances execute synchronously; a newer onmessage cannot update latestSequence during those calls. Adding a cancellation check after a completed call will not reclaim the time it already consumed.

## Other significant phases

- Before the main boundary Worker post, elapsed p50 ~1101.8 / 1149.2 / 1143.6ms. Separate 3-run early diagnostic (v3, DO NOT aggregate into v2 cold cohort): candidate-prepare wall 911.9ms, core-source 415.8ms, core-candidate 132.6ms, core-adopt 23.6ms, country IO 87.1ms, physical prepare 0.4ms. These are overlapping spans; 1100ms is neither a single CPU function nor entirely Core.
- Synchronous input Worker.postMessage p50 ~219.5 / 223.5 / 208.0ms; first Worker event.data access 243.3 / 249.1 / 235.8ms; output post ~59.8 / 59.1 / 54.2ms; main event.data access ~60.2 / 57.5 / 57.9ms. IPC and clone costs remain material after queue wait is removed.
- Diagnostic 254-country object round-trip p50 ~930.2ms vs UTF-8 transfer buffer ~532.4ms, including encoding/decoding. This is NOT an end-to-end Viewer result, and payload/transfer changes must be validated against authoritative shape/owner/quality bytes.
- GPU stroke signature includes projectGeneration and requestId. A different generation may need distinct GPU resources. Exact geometry/ownership/quality/outline/context-revision must be certified before any cross-generation reuse.

## Correctness, confidence and decision

- Country/territory properties, temporal cursor, label and boundary hashes matched across 120 primary transitions. Representative A/B pixel difference: zero. Page errors: zero. Stale-response validation, Worker failures, WebGL context restoration and four focused regressions passed. Memory measurements cover only bounded 20-transition cases and cannot prove indefinite leak-freedom.
- Trace-free cold samples were highly variable; an interim analysis process overlapped some traced runs. n10 p90 is descriptive; p95/p99 guarantees and exact GPU device runtime are not available.
- W2-P4-3: **final analysis completed**. Hold the test-only 1MiB step change from production because the end-to-end cold benefit is unproven.

## Prioritized next action: W2-P5

**Investigate and test previous/startup packet synchronous calculation blocking the latest foreground date request before changing product code.**

A. Verify by requestId, projectGeneration, boundary identity and exact timestamp whether the previous packet is mandatory for the currently displayed first map or is superseded by a new user request.
B. Use isolated same-host A-B-A: unchanged Worker -> safe priority/cancellation intervention at an existing cooperative checkpoint only for demonstrably obsolete work -> unchanged Worker. Measure Worker listener wait, startup map readiness, first presented, warm performance, cache hits, memory, input responsiveness and unchanged hashes/pixels.
C. If an old synchronous native/JS calculation is already underway, a new postMessage does not preempt it. Any cooperative chunking or cancellable native work requires separate design, strict same-result tests, rollback and bounded memory evaluation; do not assume cheap cancellation.
D. Keep country-shared-boundary source quality, exact project generation, geometry revision, requestId, temporalFrameReady, failure handling, WebGL context loss and stale-result rejection. Never omit an essential startup boundary or show an old border as the accepted new date.
E. If a low-risk cancellation mechanism cannot be proven safe or does not improve the end-to-end cold transition, next investigate the 254-country structured-clone path and then first 1.1s Core/IO/canonical work. GPU frame budget may remain a test variable but do not apply 1MiB as a blanket optimization.

## Change boundaries

This report changes documentation only on work/ui. Do not touch product runtime, C++/WASM, GIS source data, existing Windows W2-P4-2 worktrees, backups, main or the public deployment.
