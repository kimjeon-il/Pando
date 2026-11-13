import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {objectRefKey} from '../../../src/document/object-ref-identity.js';
import {createNodeSelection} from '../../helpers/core-selection.mjs';
async function currentSelectionTrace(corpus) {
  const owner = await createNodeSelection({ territorialIds: corpus.refs.map(ref => ref.id),
    genericIds: [], labelIds: [], distributionIds: [] });
  try {
    const selection = owner.domain, trace = [];
    for (const step of corpus.operations) {
      switch (step.op) {
        case 'replace': await selection.replace(step.ref, { scope: step.scope }); break;
        case 'toggle': await selection.toggle(step.ref, { scope: step.scope }); break;
        case 'range': await selection.selectRange(step.ref, step.ordered,
          { scope: step.scope, additive: step.additive }); break;
        case 'setMany': await selection.setMany(step.refs, { primary: step.primary, scope: step.scope }); break;
        case 'remove': await selection.remove(step.ref); break;
        case 'prune': await selection.prune(new Set(step.keep.map(objectRefKey))); break;
        case 'clear': await selection.clear(); break;
        default: throw new Error(`Unknown selection operation: ${step.op}`);
      }
      const snapshot = selection.snapshot();
      trace.push({ keys: snapshot.selection.keys, primaryKey: snapshot.selection.primaryKey,
        revision: snapshot.revision });
    }
    return trace;
  } finally { owner.dispose(); }
}

test('Core selection preserves ordering, anchors, pruning and no-op revisions',async()=>{
 const corpus=JSON.parse(readFileSync(new URL('../../fixtures/portability/selection.json',import.meta.url),'utf8'));
 const expected=corpus.expected.map(({keys,primaryKey,revision})=>({keys,primaryKey,revision}));
 assert.deepEqual(await currentSelectionTrace(corpus),expected);
});
