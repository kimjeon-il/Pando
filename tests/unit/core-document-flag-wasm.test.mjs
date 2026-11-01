import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';
import { currentOpaqueFlagExpectations } from '../helpers/opaque-flag-expectations.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/portability/${name}.json`,import.meta.url),'utf8'));

test('actual Worker flag promotion/null/removal and whole-document Undo match all 15 independent flag rows in the current document schema', async () => {
  const input = fixture('web-opaque-flag-input'), golden = currentOpaqueFlagExpectations();
  for (const operation of input.cases) {
    const rows = golden.cases.filter(row => row.id === operation.id), client = createNodeCoreDocument();
    const valuePresent = operation.op !== 'delete';
    const command = { commandId: 'territorial.metadata', targets: [{ domain: 'territorial',id: 'A' }],
      payload: { id: 'A',field: 'flagDataUrl',valuePresent,value: valuePresent ? operation.value : undefined } };
    try {
      await client.load(JSON.stringify(rows[0].project));
      for (const expected of rows) {
        let result = null;
        if (expected.stage === 'edited' || expected.stage === 'noop') result = await client.execute(command);
        else if (expected.stage === 'undo') result = await client.undo();
        else if (expected.stage === 'redo') result = await client.redo();
        const project = JSON.parse(await client.storageSnapshot()), state = client.state();
        assert.deepEqual(project,expected.project,`${operation.id}: ${expected.stage}`);
        assert.deepEqual(project.territorialEntities.find(row => row.id === 'A').properties.metadata,expected.metadata);
        assert.equal(state.stateRevision,expected.stateRevision);
        assert.equal(state.canUndo,expected.undo); assert.equal(state.canRedo,expected.redo);
        assert.equal(state.dirty,expected.documentDirty);
        if (result && (expected.stage === 'edited' || expected.stage === 'noop')) {
          assert.equal(result.ok,expected.result.ok); assert.equal(result.changed,expected.result.changed);
        }
      }
    } finally { client.dispose(); }
  }
});
