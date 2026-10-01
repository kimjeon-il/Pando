# Builtin place runtime design

Scope: implement stages 1–7 against main c134b297; do not implement stage 8 or
download/include production Natural Earth/GeoNames records.

Builtin records have a distinct storage owner but share the existing label
domain for identity, rendering, selection, properties, search and editable copies.
`projectState.labels` contains only user-owned records. The canonical label
presentation owner merges the bounded Worker snapshot with user labels.

Reuse `hydro-tile-window`, `worker-rpc`, `worker-rpc-host` and
`worker-job-scheduler`. Module Worker tile data and accounted LRU live in
`place-worker-store`; the snapshot/lifecycle and bounded selected-record retention
live in `place-runtime`. Existing selection, search controller, history and
autosave remain canonical owners of their responsibilities.

Interaction cancels Worker queries, blocks new requests and suppresses label
layout. Settle schedules only the latest viewport. A successful Worker result
atomically replaces the immutable snapshot before label invalidation. Render
functions consume prepared records synchronously.

Projection, date-line wrapping, globe visibility, safe bounds and label dimensions
are shared with the canonical visual frame/layout. Cull before applying the
1,500 builtin candidate limit. Layout has a 2,048 total candidate cap even for
High quality and selected/pinned labels. Batches of four tiles, bounded shards,
24MiB accounted LRU and bounded retained/search records prevent dataset-size
growth on the main thread.

Builtin properties are readonly. An explicit copy command creates a user label
with `sourcePlaceId` through existing history/autosave. Presence of the copy
suppresses the source in presentation; undo restores it. Existing search merges
local objects with bounded Worker prefix results and discards stale or closed
query responses.

Production manifest is empty. Test-only synthetic fixtures must pass the million
record gate before any future production-data work. See
[verification record](../../place-runtime.md) for measured limits and results.
