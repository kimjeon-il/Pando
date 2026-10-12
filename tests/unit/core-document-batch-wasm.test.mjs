import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';

const seed = () => JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
const field = (id,name,value) => ({ commandId: 'territorial.field', targets: [{ domain: 'territorial',id }], payload: { id,field: name,value } });
const batch = operations => ({ commandId: 'document.batch',targets: [],payload: { operations } });

test('actual ordered Worker atomic batch creates one complete Project Undo boundary and only its changed DTOs', async () => {
  const client = createNodeCoreDocument(), initial = seed();
  try {
    await client.load(JSON.stringify(initial));
    const before = client.state();
    const outcome = await client.execute(batch([field('A','name','Batch name'),field('R','notes','Batch notes')]));
    assert.equal(outcome.ok,true); assert.equal(outcome.changed,true);
    assert.equal(outcome.state.epoch,before.epoch+1); assert.equal(outcome.state.stateRevision,1);
    assert.equal(outcome.delta.objects.length,2); assert.deepEqual(outcome.delta.geometries,[]);
    const expected = structuredClone(initial);
    expected.territorialEntities.find(row => row.id === 'A').properties.name = 'Batch name';
    expected.territorialEntities.find(row => row.id === 'R').properties.notes = 'Batch notes';
    assert.deepEqual(JSON.parse(await client.storageSnapshot()),expected);
    const undone = await client.undo();
    assert.equal(undone.state.canUndo,false); assert.equal(undone.state.canRedo,true); assert.equal(undone.state.stateRevision,1);
    assert.deepEqual(JSON.parse(await client.storageSnapshot()),initial);
    await client.redo(); assert.deepEqual(JSON.parse(await client.storageSnapshot()),expected);
  } finally { client.dispose(); }
});

test('actual Worker batch cancellation and a failed second operation never commit its first operation', async () => {
  const client = createNodeCoreDocument(), initial = seed();
  try {
    await client.load(JSON.stringify(initial)); const before = client.state();
    const prepared = await client.prepare(batch([field('A','name','Prepared'),field('R','notes','Prepared notes')]));
    assert.equal(prepared.ok,true); assert.ok(prepared.candidateId>0);
    assert.deepEqual(JSON.parse(await client.storageSnapshot()),initial);
    assert.equal(await client.cancel(prepared.candidateId),true);
    assert.deepEqual(client.state(),before);
    const rejected = await client.execute(batch([field('A','name','Must roll back'),field('missing','name','Absent')]));
    assert.equal(rejected.ok,false); assert.equal(rejected.changed,false);
    assert.deepEqual(client.state(),before); assert.deepEqual(JSON.parse(await client.storageSnapshot()),initial);
    const noop = await client.execute(batch([field('A','name',initial.territorialEntities.find(row => row.id === 'A').properties.name)]));
    assert.equal(noop.ok,true); assert.equal(noop.changed,false); assert.deepEqual(client.state(),before);
  } finally { client.dispose(); }
});
