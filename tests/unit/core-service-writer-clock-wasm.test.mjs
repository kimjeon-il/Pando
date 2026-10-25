import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createGenericFeatureService } from "../../apps/editor/frontend/js/modules/generic-feature-service.js";
import { createDistributionService } from "../../apps/editor/frontend/js/modules/distribution-service.js";
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { captureWebWriterClockContract } from '../helpers/web-writer-clock-contract.mjs';

test('actual Core service commands match original generic/distribution writer clocks and accepted rows and restore removal through current Core Undo/Redo', async () => {
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  Object.assign(seed,{ labels: [],labelSettings: {},hydroEdits: [],genericFeatures: [],distributionLayers: [],distributionEntries: [] });
  const owner=await createNodeCoreProject(seed),generic=createGenericFeatureService({ documentModel: owner.documentModel,commandOwner: owner.project }),
    distribution=createDistributionService({ documentModel: owner.documentModel,commandOwner: owner.project });
  const expected=captureWebWriterClockContract().rows.slice(0,16);
  const feature={ type: 'Feature',id: 'G',geometry: { type: 'Point',coordinates: [1.125,2.25] },
    properties: { schemaVersion: 2,name: 'G',notes: '',color: '#8c68d8',locked: false,source: { kind: 'drawn',license: '',details: {} } } };
  const actions=[() => {},() => generic.add(feature),() => generic.updateMetadata('G','name',' G '),
    () => generic.updateMetadata('G','notes','  kept  '),() => generic.updateMetadata('missing','notes','x'),
    () => generic.updateMetadata('G','unsupported','x'),() => generic.addMany([]),() => generic.remove('G'),() => generic.remove('G'),
    () => distribution.createLayer({ id: 'L',name: 'L' }),() => distribution.updateLayer('L','name',' L '),
    () => distribution.addEntry({ id: 'E',layerId: 'L',mode: 'geometry',geometry: { type: 'Polygon',coordinates: [[[0,0],[1,0],[1,1],[0,0]]] },value: '2.125' }),
    () => distribution.updateEntry('E',' 2.125 '),() => distribution.updateEntry('E','3.25'),() => distribution.append({}),
    () => distribution.deleteLayer('L') ];
  let beforeRemoval;
  try {
    for (const [index,action] of actions.entries()) {
      if(index===15)beforeRemoval=structuredClone(owner.documentModel.snapshot());
      const original=expected[index];let result,error;
      try { result=await action(); } catch (failure) { error=failure; }
      if (original.error) {
        assert.ok(error,original.operation);assert.equal(error.message,original.error.message,original.operation);
        assert.equal(error.code ?? null,original.error.code,`${original.operation}: public expected-error code`);
      }
      else { assert.equal(error,undefined,original.operation);assert.deepEqual(result===undefined ? null : result,original.result,original.operation); }
      const state=owner.client.state(),model=owner.documentModel.snapshot();
      assert.equal(state.stateRevision,original.stateRevision,original.operation);
      assert.equal(state.documentDirty,original.dirty,original.operation);
      assert.equal(state.presentationDirty,original.presentationDirty,original.operation);
      assert.equal(state.canUndo,original.undo,original.operation);assert.equal(state.canRedo,original.redo,original.operation);
      assert.deepEqual(model.genericFeatures,original.genericFeatures,original.operation);
      assert.deepEqual(model.distributionLayers,original.distributionLayers,original.operation);
      assert.deepEqual(model.distributionEntries,original.distributionEntries,original.operation);
      assert.deepEqual(model.geometries,seed.geometries,`${original.operation}: stored territorial archive unchanged`);
      assert.deepEqual(model.sourceInfo,seed.sourceInfo,`${original.operation}: source evidence unchanged`);
    }
    const afterRemoval=structuredClone(owner.documentModel.snapshot());
    assert.equal(await owner.project.undo(),true);
    assert.deepEqual(owner.documentModel.snapshot().distributionLayers,beforeRemoval.distributionLayers);
    assert.deepEqual(owner.documentModel.snapshot().distributionEntries,beforeRemoval.distributionEntries);
    assert.equal(await owner.project.redo(),true);assert.deepEqual(owner.documentModel.snapshot(),afterRemoval);
  } finally { owner.dispose(); }
});
