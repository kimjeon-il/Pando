import assert from 'node:assert/strict';
import test from 'node:test';
import { captureWebContentDirtyContract } from '../helpers/web-content-dirty-contract.mjs';

test('original label content history owns automatic settings without marking the independent presentation lane dirty', () => {
  const rows = captureWebContentDirtyContract();
  assert.deepEqual(rows.map(row => [row.labels.length,Object.keys(row.labelSettings).length,row.documentDirty,row.presentationDirty,
    row.hasUnsavedChanges,row.currentContentToken,row.currentPresentationToken,row.file,row.undo,row.redo,row.stateRevision]), [
    [0,0,false,false,false,'content:0','presentation:0','never-saved',false,false,0],
    [1,1,true,false,true,'content:1','presentation:0','dirty',true,false,0],
    [0,0,false,false,false,'content:0','presentation:0','never-saved',false,true,0],
    [1,1,true,false,true,'content:1','presentation:0','dirty',true,false,0],
    [1,1,false,false,false,'content:1','presentation:0','saved',true,false,0],
    [0,0,true,false,true,'content:2','presentation:0','dirty',true,false,0],
    [1,1,false,false,false,'content:1','presentation:0','clean',true,true,0],
    [0,0,true,false,true,'content:2','presentation:0','dirty',true,false,0],
    [0,0,true,true,true,'content:2','presentation:3','dirty',true,false,0],
    [1,1,false,true,true,'content:1','presentation:3','dirty',true,true,0],
  ]);
  const id = '22000000-0000-4000-8000-000000000011';
  const label = { id,name: 'New label',kind: 'city',coordinates: [1.125,2.25],notes: '' };
  const settings = { priority: 70,minZoom: 1.25,maxZoom: Infinity,manualPosition: null,pinned: false,collisionGroup: 'place' };
  for (const row of rows) {
    assert.deepEqual(row.labels,row.labels.length ? [label] : []);
    assert.deepEqual(row.labelSettings,row.labels.length ? { [`label:${id}`]: settings } : {});
  }
  assert.deepEqual(rows[9].layerVisibility,{ labels: false });
});
