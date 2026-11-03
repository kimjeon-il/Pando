import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/portability/${name}.json`,import.meta.url),'utf8'));
const webDraft = snapshot => ({ coords: snapshot.coords, inputPhase: snapshot.inputPhase,
  vertexInsertMode: snapshot.insertMode, selectedVertexIndex: snapshot.selectedVertexIndex,
  insertTarget: snapshot.insertTarget, dragging: snapshot.dragging,
  historyCount: snapshot.historyCount, futureCount: snapshot.futureCount });

test('actual Worker detached draft result and all owned fields match the 23-step frozen original Web trace', async () => {
  const client = createNodeCoreDocument(), expected = fixture('web-draft-contract'), seed = fixture('web-document-seed');
  const apply = (action, payload = {}) => client.draftApply({ action,...payload });
  const actions = [
    async () => { await apply('start',{ shape: 'polygon', coords: [], inputPhase: 'draw' }); return apply('clear'); },
    () => apply('start',{ shape: 'polygon', coords: [[0,0],[12,0],[12,8]], inputPhase: 'draw' }),
    () => apply('beginDrag',{ index: 1 }),
    () => apply('finishDrag'),
    () => apply('undo'),
    () => apply('redo'),
    () => apply('beginDrag',{ index: 2 }),
    () => apply('queueDrag',{ coordinate: [14.125,9.25] }),
    () => apply('queueDrag',{ coordinate: [15.125,10.25] }),
    () => apply('finishDrag'),
    () => apply('undo'),
    () => apply('setInsertMode',{ insertMode: true }),
    () => apply('setInsertTarget',{ insertTarget: { segmentIndex: 2, coordinate: [6,4] } }),
    () => apply('insertAt',{ segmentIndex: 2, coordinate: [6,4] }),
    () => apply('deleteSelected'),
    () => apply('undo'),
    () => apply('redo'),
    () => apply('selectVertex',{ index: 999 }),
    async () => { await apply('beginDrag',{ index: 1 }); return apply('cancelDrag'); },
    () => apply('clear'),
    () => apply('undo'),
    async () => {
      let outcome;
      for (let index = 0; index < 101; index++) outcome = await apply('replaceCoordinates',{
        coords: [[index+0.125,0],[index+1.25,1],[index+2.5,3]], record: true, selectedVertexIndex: 1, inputPhase: 'refine' });
      return { result: outcome.snapshot.historyCount, snapshot: outcome.snapshot };
    },
    () => apply('undo'),
  ];
  assert.equal(actions.length, expected.length);
  try {
    await client.load(JSON.stringify(seed)); const state = client.state(); const loadedSnapshot=JSON.parse(await client.storageSnapshot());
    for (const [index, action] of actions.entries()) {
      const actual = await action(), web = expected[index];
      assert.equal(actual.result, web.result, web.operation);
      const projected = webDraft(actual.snapshot);
      assert.deepEqual(projected, Object.fromEntries(Object.keys(projected).map(key => [key,web.snapshot.draft[key]])),web.operation);
      assert.equal(actual.snapshot.active, web.snapshot.draft.active);
      assert.equal(actual.snapshot.shape, 'polygon');
      assert.deepEqual(client.state(),state,'Detached draft cannot advance Project history/dirty/revision/epoch.');
    }
    assert.deepEqual(JSON.parse(await client.storageSnapshot()),loadedSnapshot);
  } finally { client.dispose(); }
});

test('actual Worker resets the detached draft on document load and rejects an old-project draft action', async () => {
  const client = createNodeCoreDocument(), seed = fixture('web-document-seed');
  try {
    await client.load(JSON.stringify(seed)); const oldEpoch = client.state().epoch;
    await client.draftApply({ action: 'start', shape: 'line', coords: [[0,0],[1,1]], inputPhase: 'draw' });
    await client.draftApply({ action: 'append', coordinate: [2,2] });
    await client.load(JSON.stringify(seed)); const state = client.state();
    const draft = await client.draftSnapshot();
    assert.equal(draft.active,false); assert.deepEqual(draft.coords,[]);
    assert.equal(draft.historyCount,0); assert.equal(draft.futureCount,0); assert.equal(draft.dragging,false);
    await assert.rejects(client.draftApply({ action: 'append', coordinate: [3,3], expectedEpoch: oldEpoch }), { code: 'STALE_REVISION' });
    assert.deepEqual(await client.draftSnapshot(),draft); assert.deepEqual(client.state(),state);
  } finally { client.dispose(); }
});

test('a computed draft replacement from an older draft revision cannot overwrite a later accepted edit', async () => {
  const client=createNodeCoreDocument();
  try {
    await client.load(JSON.stringify(fixture('web-document-seed')));
    const origin=(await client.draftApply({ action: 'start',shape: 'line',coords: [[0,0],[1,1]],inputPhase: 'draw' })).snapshot;
    const current=(await client.draftApply({ action: 'append',coordinate: [2.125,3.25] })).snapshot;
    await assert.rejects(client.draftApply({ action: 'replaceCoordinates',expectedDraftRevision: origin.revision,
      coords: [[7,8],[9,10]],record: true,selectedVertexIndex: null,inputPhase: 'refine' }),{ code: 'STALE_DRAFT_REVISION' });
    assert.deepEqual(await client.draftSnapshot(),current);
    assert.equal(client.state().canUndo,false);assert.equal(client.state().dirty,false);
  } finally { client.dispose(); }
});
