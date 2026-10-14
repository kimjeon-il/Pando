import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';

const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
async function withDraft(action) {
  const client=createNodeCoreDocument();
  try { await client.load(JSON.stringify(seed));await action(client); }
  finally { client.dispose(); }
}

test('Core draft vertices move, insert, delete and remove from the tail without changing document state', async () => {
  await withDraft(async client => {
    const original=[[0,0],[10,0],[10,10]],state=client.state();
    const apply=(action,payload={}) => client.draftApply({ action,...payload });
    await apply('start',{ shape: 'line',coords: original,inputPhase: 'draw' });
    await apply('beginDrag',{ index: 1 });
    assert.deepEqual((await apply('moveDrag',{ coordinate: [8,2] })).snapshot.coords,[[0,0],[8,2],[10,10]]);
    await apply('finishDrag');await apply('undo');
    const inserted=await apply('insertAt',{ segmentIndex: 0,coordinate: [5,0] });
    assert.equal(inserted.snapshot.selectedVertexIndex,1);
    assert.deepEqual(inserted.snapshot.coords,[[0,0],[5,0],[10,0],[10,10]]);
    const deleted=await apply('deleteSelected');
    assert.deepEqual(deleted.snapshot.coords,original);assert.equal(deleted.snapshot.selectedVertexIndex,0);
    await apply('selectVertex',{ index: 2 });
    const shortened=await apply('removeLast');
    assert.deepEqual(shortened.snapshot.coords,[[0,0],[10,0]]);assert.equal(shortened.snapshot.selectedVertexIndex,1);
    assert.deepEqual(client.state(),state);
  });
});

test('Core polygon closing segment inserts after the last vertex', async () => {
  await withDraft(async client => {
    await client.draftApply({ action: 'start',shape: 'polygon',coords: [[0,0],[10,0],[5,10]],inputPhase: 'draw' });
    const inserted=await client.draftApply({ action: 'insertAt',segmentIndex: 2,coordinate: [2,5] });
    assert.equal(inserted.snapshot.selectedVertexIndex,3);
    assert.deepEqual(inserted.snapshot.coords,[[0,0],[10,0],[5,10],[2,5]]);
  });
});

test('Core draft Undo and Redo retain vertex/phase locally and a new mutation clears Redo', async () => {
  await withDraft(async client => {
    const apply=(action,payload={}) => client.draftApply({ action,...payload });
    await apply('start',{ shape: 'line',coords: [],inputPhase: 'draw' });
    await apply('replaceCoordinates',{ coords: [[0,0]],record: true,selectedVertexIndex: 0,inputPhase: 'refine' });
    await apply('replaceCoordinates',{ coords: [[0,0],[10,0]],record: true,selectedVertexIndex: 1,inputPhase: 'refine' });
    const undone=(await apply('undo')).snapshot;
    assert.deepEqual(undone.coords,[[0,0]]);assert.equal(undone.selectedVertexIndex,0);assert.equal(undone.inputPhase,'refine');
    const redone=(await apply('redo')).snapshot;
    assert.deepEqual(redone.coords,[[0,0],[10,0]]);assert.equal(redone.selectedVertexIndex,1);assert.equal(redone.inputPhase,'refine');
    await apply('undo');
    assert.equal((await apply('replaceCoordinates',{ coords: [[0,0]],record: true,selectedVertexIndex: 0,inputPhase: 'refine' })).snapshot.futureCount,0);
    assert.equal(client.state().canUndo,false);assert.equal(client.state().dirty,false);
  });
});
