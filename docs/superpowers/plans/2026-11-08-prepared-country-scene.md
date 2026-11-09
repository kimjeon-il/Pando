# Prepared initial country scene

Goal: admit an exact, immutable initial Viewer scene without browser triangulation,
stroke preparation or spatial partitioning. Do not change editor/document semantics,
main or the public deployment.

The existing canonical mesh has 258 slots; the current Viewer has 207 roots.
Runtime-packet SHA-256 comparison found 204 exact roots and three changed roots
(BRA, CHN, COL). The build reuses proven source slots, computes only changed roots,
and stores the explicit slot identities plus prepared strokes, shared boundaries and
spatial trees. The existing builtin mesh resource owner delivers the package. A
historical/imported scene which does not match the declared identity retains the
current calculation path; corrupt/missing declared assets fail instead of becoming
silent computation fallbacks.

Tasks:
1. Executable codec/slot/identity tests: reject equal-count wrong IDs, changed geometry,
   hierarchy, malformed buffers; retain reordered caller IDs via artifact slot order.
2. Add a prepared scene to the current world bundle; generate from pinned canonical
   country packet plus the authoritative builtin timeline. Preserve all geometry.
3. Wire initial Viewer admission and existing boundary/GPU publication owners to
   prepared results. Preserve cancellation, generation guards and context recovery.
4. Run focused unit and real browser first-load/reload/date tests; record zero
   triangulation for matched initial scene and actual country/border publication.
5. Commit task-owned changes, publish matching data to existing work branch only,
   verify remote identities, and remove the temporary inspection workflow.

Review focus: source slot versus caller order; parent relations; stale async results;
shader/context loss; missing/corrupt assets versus legitimate unmatched historical data.
