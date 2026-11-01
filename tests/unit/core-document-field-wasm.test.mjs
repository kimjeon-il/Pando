import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';

const seed = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url),'utf8'));

for (const id of ['A','R']) for (const [field,value,stored] of [['notes','  kept whitespace\r\n  ','kept whitespace'],['name','','']]) {
  test(`actual current document ${id}.${field} preserves normalization, no-op clocks, full storage and Undo/Redo`, async () => {
    const client = createNodeCoreDocument(), edited = structuredClone(seed);
    edited.territorialEntities.find(row => row.id === id).properties[field] = stored;
    const command = { commandId: 'territorial.field', targets: [{ domain: 'territorial', id }], payload: { id, field, value } };
    const edits = field === 'notes' ? 2 : 1;
    const observe = async (project, dirty, canUndo, canRedo, revision = edits) => {
      assert.deepEqual(JSON.parse(await client.storageSnapshot()), project);
      assert.equal(client.state().stateRevision, revision);
      assert.equal(client.state().dirty, dirty);
      assert.equal(client.state().canUndo, canUndo);
      assert.equal(client.state().canRedo, canRedo);
    };
    try {
      await client.load(JSON.stringify(seed));
      await observe(seed, false, false, false, 0);
      for (let index = 0; index < 2; index++) {
        const actual = await client.execute(command);
        assert.equal(actual.ok, true);
        assert.equal(actual.changed, field === 'notes' || index === 0,
          'Raw notes that normalize to the stored value retain the declared checkpoint; equal raw names do not.');
        await observe(edited, true, true, false, Math.min(index + 1, edits));
      }
      const noOp = await client.execute({ ...command, payload: { ...command.payload, value: stored } });
      assert.equal(noOp.changed, false, 'Exact raw-value equality remains a no-op.');
      await observe(edited, true, true, false);
      for (let index = 0; index < 2; index++) {
        const actual = await client.undo(), remaining = Math.max(0, edits-index-1);
        assert.equal(actual.changed, index < edits);
        await observe(remaining ? edited : seed, remaining > 0, remaining > 0, true);
      }
      for (let index = 0; index < 2; index++) {
        const actual = await client.redo();
        assert.equal(actual.changed, index < edits);
        await observe(edited, true, true, index+1 < edits);
      }
    } finally { client.dispose(); }
  });
}
