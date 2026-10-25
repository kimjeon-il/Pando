import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';
import { loadWebOracle } from '../helpers/web-oracle.mjs';
const { createDistributionLayer,createDistributionEntry }=await loadWebOracle('assets/js/modules/distribution-model.js');
import {assertCurrentProjectSchema} from "../../shared/frontend/js/modules/project-state.js";
function originalInput() {
  const input=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  input.distributionLayers[0]=createDistributionLayer({ ...input.distributionLayers[0],metadata: ['a',{sourceRef:'retained'}] });
  input.distributionEntries[0]=createDistributionEntry({ ...input.distributionEntries[0],metadata: ['b',null] });
  assertCurrentProjectSchema(input);
  return input;
}
test('current Web schema preserves the frozen original distribution metadata array values',() => {
  const input=originalInput();
  assert.deepEqual(input.distributionLayers[0].metadata,['a',{sourceRef:'retained'}]);
  assert.deepEqual(input.distributionEntries[0].metadata,['b',null]);
});
test('actual Core loads, edits, exports and undoes the same valid distribution array metadata',async () => {
  const initial=originalInput(),client=createNodeCoreDocument();
  try {
    await client.load(JSON.stringify(initial));
    assert.deepEqual(JSON.parse(await client.storageSnapshot()),initial);
    const id=initial.distributionLayers[0].id;
    const changed=await client.execute({ commandId:'distribution.layer.metadata',targets:[{domain:'distributionLayer',id}],payload:{id,field:'name',value:' renamed '} });
    assert.equal(changed.ok,true);
    const expected=structuredClone(initial);expected.distributionLayers[0].name='renamed';
    assert.deepEqual(JSON.parse(await client.storageSnapshot()),expected);
    const saved=await client.exportSnapshot({format:'pandolab-project-state',version:initial.version,savedAt:initial.savedAt});
    assert.deepEqual(JSON.parse(saved.storageJson),expected);
    await client.undo();assert.deepEqual(JSON.parse(await client.storageSnapshot()),initial);
  }finally{client.dispose();}
});
