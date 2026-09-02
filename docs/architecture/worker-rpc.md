# Worker RPC architecture

## Boundary

CPU-heavy Worker calls use one RPC transport instead of defining a new `pending` map, timeout loop, cancellation message, stale-result rule, and error shape for every feature.

The canonical client is `assets/js/modules/worker-rpc.js`. New Worker endpoints use `assets/js/workers/worker-rpc-host.js`.

A request carries these concepts through one contract:

```text
requestId
operation
projectRevision
priority
payload / metadata
cancellation
client timeout
error category + code
timing
transferables
```

The client owns request IDs, pending promises, AbortSignal handling, timeout cancellation, Worker crash rejection/restart, metrics, and stale-result rejection. Feature code should not recreate those mechanisms.

## Scheduling versus RPC

`worker-job-scheduler.js` and Worker RPC solve different problems.

- `worker-job-scheduler.js`: priority, latest-wins coalescing, concurrency and job-key policy.
- `worker-rpc.js`: transport lifecycle and request/result correctness.

A latency-sensitive feature may compose them. The map-edit client does this: the scheduler decides which edit survives; Worker RPC owns the actual in-flight request.

## Stateful and stateless Workers

Stateless CPU geometry work may use `worker-rpc-pool.js`. Pool sizing is conservative:

- mobile: 1 worker normally, at most 2 on higher-concurrency devices;
- desktop: `min(4, hardwareConcurrency - 1)`, with a minimum of 1.

Stateful or data-owning Workers should remain dedicated when sharing would duplicate large state or break locality. Current examples include map-edit, data-loader, hydro-tile and Canvas rendering. Dedicated does not mean ad-hoc transport: stateful clients can still use Worker RPC for request lifecycle.

## Transitional compatibility

The existing map-edit and GIS geometry Workers predate the RPC wire envelope. Their callers now use `createWorkerRpcClient()` with narrow compatibility codecs, so pending/cancel/timeout/stale/error logic is already centralized without a risky simultaneous rewrite of business logic.

GPU mesh, geometry validation, and river partition Workers expose canonical RPC operations while temporarily retaining their old message entry points for current renderer/controllers. These compatibility bridges are removal targets as their callers migrate.

Do not add another compatibility codec for new functionality. New Worker work uses the canonical envelope directly.

## Canonical operations introduced in phase 9

```text
geometry.mesh
geometry.audit
river.partition
```

Map-edit operations keep their existing business operation names behind the RPC client until the stateful Worker protocol is migrated fully.

## Transferables

Transferables stay explicit. `worker-rpc.js` accepts a request `transfer` list and the Worker host supports `transferResult(result, transferables)`. The GPU mesh Worker continues transferring mesh ArrayBuffers rather than cloning them.

## Rules for new Worker functionality

1. Create or reuse a `createWorkerRpcClient()` or `createWorkerRpcPool()` instance.
2. Give every request a semantic `operation` and the relevant `projectRevision`.
3. Use `priority` for scheduling intent; do not invent a second priority field.
4. Use `AbortSignal` or the RPC cancel API; do not create a feature-specific cancellation set in the client.
5. Let the RPC client own timeouts and Worker crash handling.
6. Return typed Worker errors; do not parse user-facing strings to infer failure type.
7. Reject stale results at the RPC boundary before they reach project state.
8. Pass ArrayBuffers in transfer lists when ownership can move safely.
9. Keep persistent data/hydro/Canvas Workers specialized if their state model requires it.
10. Add Worker RPC and architecture tests before introducing a new transport exception.
