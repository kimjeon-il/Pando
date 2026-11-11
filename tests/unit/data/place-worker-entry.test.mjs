import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

test('place Worker starts with explicitly supplied build and data identity', async t => {
  const worker = new Worker(new URL('../../helpers/place-worker-thread.mjs', import.meta.url),
    {workerData:{assetRevision:'place-worker-fixture'}});
  t.after(() => worker.terminate());
  const message = await new Promise((resolve, reject) => {
    worker.once('message', resolve); worker.once('error', reject);
  });
  assert.deepEqual(message, {ready:true});
});
