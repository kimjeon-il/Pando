// TEST-ONLY instrumentation. It is forbidden to run this on a distributable source tree.
// Applies temporary hooks in a disposable GitHub Actions checkout, not in committed modules.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

assert.equal(process.env.PANDO_CORE_CANDIDATE_DIAGNOSTIC_ISOLATED, '1',
  'Instrumentation may only run in a disposable, isolated acceptance checkout');

const patches = [
  {
    path: 'assets/js/modules/core-document-client.js',
    before: `      const { result } = await rpc.request(operation, request, atomic
        ? { timeoutMs: 0 } : { signal: options.signal });`,
    after: `      // OBJ097 isolated diagnostics: observe how long the real C++ prepare runs,
      // rather than treating the production RPC default 30s timeout as a CPU sample.
      // This change is applied to a disposable CI checkout only.
      const optionsForCall = operation === 'core.document-prepare'
        ? { timeoutMs: 0, signal: options.signal } : atomic
          ? { timeoutMs: 0 } : { signal: options.signal };
      const { result } = await rpc.request(operation, request, optionsForCall);`,
  },
  {
    path: 'assets/js/modules/core-worker-runtime.js',
    before: `  function dispatch(operation, payload, context) {
    const result = queue.then(async () => {
      context.throwIfCancelled();`,
    after: `  function dispatch(operation, payload, context) {
    const receivedAt = performance.now();
    const result = queue.then(async () => {
      if (operation === 'core.document-prepare')
        self.postMessage({ type: 'OBJ097_CORE_STAGE', phase: 'dispatch-queue-enter',
          queuedMs: performance.now() - receivedAt, atMs: performance.now() });
      context.throwIfCancelled();`,
  },
  {
    path: 'assets/js/modules/core-worker-runtime.js',
    before: `      const outcome=await document[method](payload,context);
      if (admission) loaded=true;`,
    after: `      const startedAt = performance.now();
      if (operation === 'core.document-prepare')
        self.postMessage({ type: 'OBJ097_CORE_STAGE', phase: 'runtime-before-document',
          atMs: startedAt });
      const outcome=await document[method](payload,context);
      if (operation === 'core.document-prepare')
        self.postMessage({ type: 'OBJ097_CORE_STAGE', phase: 'runtime-after-document',
          elapsedMs: performance.now() - startedAt, atMs: performance.now(),
          candidateId: outcome?.candidateId ?? null, changed: outcome?.changed ?? null });
      if (admission) loaded=true;`,
  },
  {
    path: 'assets/js/modules/core-document-runtime.js',
    before: `  function call(method, args, context, projectResult = result => result) {
    const result = queue.then(async () => {`,
    after: `  function call(method, args, context, projectResult = result => result) {
    const queuedAt = performance.now();
    const result = queue.then(async () => {
      if (method === 'prepareCommand')
        self.postMessage({ type: 'OBJ097_CORE_STAGE', phase: 'document-queue-enter',
          queuedMs: performance.now() - queuedAt, atMs: performance.now() });`,
  },
  {
    path: 'assets/js/modules/core-document-runtime.js',
    before: `      return projectResult(core[method](...(typeof args === 'function' ? args() : args)),core);`,
    after: `      const parameters = typeof args === 'function' ? args() : args;
      if (method === 'prepareCommand')
        self.postMessage({ type: 'OBJ097_CORE_STAGE', phase: 'wasm-call-enter',
          atMs: performance.now(), commandId: parameters?.[0]?.commandId ?? null,
          operationCount: parameters?.[0]?.payload?.operations?.length ?? null });
      const beforeWasm = performance.now();
      const response = core[method](...parameters);
      const wasmElapsedMs = performance.now() - beforeWasm;
      if (method === 'prepareCommand')
        self.postMessage({ type: 'OBJ097_CORE_STAGE', phase: 'wasm-call-return',
          atMs: performance.now(), elapsedMs: wasmElapsedMs, changed: response?.changed ?? null });
      const beforeProjection = performance.now();
      const projected = projectResult(response, core);
      if (method === 'prepareCommand')
        self.postMessage({ type: 'OBJ097_CORE_STAGE', phase: 'document-projection-return',
          atMs: performance.now(), elapsedMs: performance.now() - beforeProjection });
      return projected;`,
  },
];

const cleanPaths = new Set();
for (const [index, patch] of patches.entries()) {
  const original = await readFile(patch.path, 'utf8');
  assert.equal(original.split(patch.before).length, 2, 'Unexpected source anchor #'+index+' in '+patch.path);
  if (!cleanPaths.has(patch.path)) {
    assert.ok(!original.includes('OBJ097_CORE_STAGE'),
      'Refusing to mutate product checkout with existing OBJ097 hooks: '+patch.path);
    cleanPaths.add(patch.path);
  }
  const modified = original.replace(patch.before, patch.after);
  await writeFile(patch.path, modified);
  console.log('OBJ097_INSTRUMENTED', patch.path, index + 1);
}
