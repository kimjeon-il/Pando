import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuiltinSession } from '../../assets/js/modules/app-builtin-session.js';

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
