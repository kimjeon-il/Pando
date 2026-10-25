import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';
import { createCoreDocumentReadModel } from "../../shared/frontend/js/modules/core-document-read-model.js";

const seed = () => JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
const field = (id, name, value) => ({ commandId: 'territorial.field', targets: [{ domain: 'territorial', id }], payload: { id, field: name, value } });

test('actual document WASM owns complete storage, publishes exact small deltas and travels whole-project history', async () => {
  const initial = seed(), model = createCoreDocumentReadModel(initial);
  const client = createNodeCoreDocument({ onTransition(result) { if (result.delta) model.apply(result.delta); } });
  try {
    const loaded = await client.load(JSON.stringify(initial));
    assert.equal(loaded.state.stateRevision, 0);
    assert.deepEqual(loaded.project,initial);
    assert.equal(loaded.draft.active,false);
    assert.deepEqual(loaded.selection.items,[]);
    assert.deepEqual(JSON.parse(await client.storageSnapshot()), initial);
    const changed = await client.execute(field('A', 'name', 'Worker rename'));
    assert.equal(changed.ok, true); assert.equal(changed.changed, true);
    assert.equal(changed.state.stateRevision, 1); assert.equal(changed.state.canUndo, true);
    const expected = structuredClone(initial); expected.territorialEntities.find(row => row.id === 'A').properties.name = 'Worker rename';
    assert.deepEqual(model.snapshot(), expected);
    assert.deepEqual(JSON.parse(await client.storageSnapshot()), expected);
    assert.equal(Object.hasOwn(model.snapshot(), 'originalArchive'), false);
    assert.equal((await client.undo()).state.stateRevision, 1);
    assert.deepEqual(model.snapshot(), initial);
    assert.deepEqual(JSON.parse(await client.storageSnapshot()), initial);
    assert.equal(client.state().dirty, false);
    assert.equal((await client.redo()).state.stateRevision, 1);
    assert.deepEqual(model.snapshot(), expected);
    assert.equal(client.state().dirty, true);
    assert.equal((await client.markSaved(client.state().epoch)).dirty, false);
    assert.equal(changed.delta.objects.length, 1, 'Metadata transport must include only actual changed object data.');
  } finally { client.dispose(); }
});

test('actual document WASM no-op, rejection and cancelled preview preserve every domain and revision', async () => {
  const initial = seed(), client = createNodeCoreDocument();
  try {
    await client.load(JSON.stringify(initial));
    const before = client.state();
    const name = initial.territorialEntities.find(row => row.id === 'A').properties.name;
    const noop = await client.execute(field('A', 'name', name));
    assert.equal(noop.ok, true); assert.equal(noop.changed, false);
    assert.deepEqual(client.state(), before);
    const preview = await client.prepare(field('A', 'name', 'Unconfirmed rename'));
    assert.equal(preview.ok, true); assert.ok(preview.candidateId > 0);
    assert.deepEqual(client.state(), before);
    assert.equal(await client.cancel(preview.candidateId), true);
    assert.deepEqual(client.state(), before);
    await assert.rejects(client.execute(field('A', 'retiredField', 'invalid')), { code: 'CORE_COMMAND_FIELD' });
    assert.deepEqual(client.state(), before);
    assert.deepEqual(JSON.parse(await client.storageSnapshot()), initial);
    assert.equal((await client.resolveWorld('2020-01')).month, '2020-01');
    assert.equal(client.state().epoch, before.epoch);
  } finally { client.dispose(); }
});
