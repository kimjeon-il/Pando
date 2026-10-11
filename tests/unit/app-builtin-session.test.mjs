import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuiltinSession } from '../../assets/js/modules/app-builtin-session.js';
import { smallHistoricalWorld } from '../helpers/historical-world.mjs';

test('baseline preparation reports loader failure instead of waiting on an unresolved geometry promise', {timeout:3000}, async t => {
  const previous=globalThis.window;
  const target=new globalThis.EventTarget();
  target.PANDOLAB_CANONICAL_GEOMETRY_PROMISE=new Promise(()=>{});
  globalThis.window=target; t.after(()=>{globalThis.window=previous;});
  target.addEventListener('pandolab:canonical-geometry-required',()=>target.dispatchEvent(new globalThis.CustomEvent('pandolab:geometry-error',{detail:'baseline unavailable'})),{once:true});
  const owner=createBuiltinSession(); owner.connect({platformConfigurationA:{BASE_DATASET:'fixture'}});
  await assert.rejects(owner.prepareProjectBaseline(),{code:'PL-SCHEMA-BASE',message:'baseline unavailable'});
  await assert.rejects(Promise.race([owner.prepareProjectBaseline(),new Promise(resolve=>setTimeout(()=>resolve('pending'),30))]),
    {code:'PL-SCHEMA-BASE',message:'baseline unavailable'});
  assert.equal(owner.projectBaseline,null);
});
test('baseline carries full identities and stored-byte fingerprint', async t => {
  const previous = globalThis.window, project = smallHistoricalWorld();
  globalThis.window = { PANDOLAB_BUILD_META: { historicalWorld: { url: 'manifest', sha256: 'f'.repeat(64), compressedBytes: 1, decodedBytes: 1, encoding: 'identity' } } };
  t.after(() => { globalThis.window = previous; });
  const owner = createBuiltinSession({ historicalWorldLoader: { loadProject: async () => ({ project, manifest: { project: { sha256: 'a'.repeat(64) }, sourceMonth: '2026-10' } }) } });
  owner.connect({ platformConfigurationA: { BASE_DATASET: 'fixture' } });
  const baseline = await owner.prepareProjectBaseline();
  assert.deepEqual(baseline.project, project);
  assert.equal(baseline.baseEntities.length, 2); assert.equal(baseline.baseDatasetFingerprint, 'a'.repeat(64));
});
