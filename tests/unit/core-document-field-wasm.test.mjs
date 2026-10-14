import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createOriginalFullDocumentFixture } from '../helpers/web-full-document-fixture.mjs';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';

const seed = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url),'utf8'));

for (const id of ['A','R']) for (const [field,value] of [['notes','  kept whitespace\r\n  '],['name','']]) {
  test(`actual document ${id}.${field} follows original Web normalization, result/history and full storage`, async () => {
    const web = createOriginalFullDocumentFixture(seed), client = createNodeCoreDocument();
    const command = { commandId: 'territorial.field', targets: [{ domain: 'territorial', id }], payload: { id, field, value } };
    try {
      await client.load(JSON.stringify(web.project));
      for (let index = 0; index < 2; index++) {
        const expected = web.service.updateMetadata(id,field,value);
        const actual = await client.execute(command);
        assert.equal(actual.ok, expected.ok);
        assert.equal(actual.changed, expected.changed, `The current Web action result at iteration ${index + 1} is part of the contract.`);
        assert.equal(client.state().stateRevision, web.state.stateRevision);
        assert.equal(client.state().dirty, web.saveState.snapshot().documentDirty);
        assert.deepEqual(JSON.parse(await client.storageSnapshot()), web.fullSnapshot());
      }
      const storedValue = web.repository.get(id).properties[field];
      assert.equal(web.service.updateMetadata(id,field,storedValue).changed, false, 'Actual raw-value equality remains a no-op.');
      assert.equal((await client.execute({ ...command, payload: { ...command.payload, value: storedValue } })).changed, false);
      assert.equal(client.state().stateRevision, web.state.stateRevision);
      for (let index = 0; index < 2; index++) {
        const actual = await client.undo(), changed = web.domain.undo();
        assert.equal(actual.changed, changed);
        assert.deepEqual(JSON.parse(await client.storageSnapshot()), web.fullSnapshot());
        assert.equal(client.state().stateRevision, web.state.stateRevision);
        assert.equal(client.state().dirty, web.saveState.snapshot().documentDirty);
        assert.equal(client.state().canUndo, web.domain.canUndo());
      }
    } finally { client.dispose(); }
  });
}
