import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';
import { loadWebOracle } from '../helpers/web-oracle.mjs';

const { normalizeGenericFeatureSemantics } = await loadWebOracle('assets/js/modules/generic-feature-service.js');
const seed = () => JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
const command = (commandId, domain, id, payload) => ({ commandId, targets: [{ domain, id }], payload });

test('actual Core content creation keeps original Web source annotations and archive with one history checkpoint', async () => {
  const client = createNodeCoreDocument();
  try {
    const initial = seed();
    await client.load(JSON.stringify(initial));
    const raw = { type: 'Feature', id: '22000000-0000-4000-8000-000000000019',
      geometry: { type: 'Point', coordinates: [1.125, 2.25] },
      properties: { schemaVersion: 2, name: '  Created  ', notes: '', color: '#8c68d8', locked: false,
        source: { kind: 'drawn', license: '', details: {} } } };
    const outcome = await client.execute(command('generic.create', 'generic', raw.id, { feature: raw }));
    assert.equal(outcome.ok, true);
    assert.equal(outcome.state.stateRevision, 1);
    assert.equal(outcome.state.checkpoint, 1);
    assert.equal(outcome.state.documentDirty, true);
    assert.equal(outcome.state.presentationDirty, false);
    assert.equal(outcome.delta.objects.length, 1);
    const expected = structuredClone(initial);
    expected.genericFeatures.push(normalizeGenericFeatureSemantics(structuredClone(raw)));
    assert.deepEqual(JSON.parse(await client.storageSnapshot()), expected);
    assert.deepEqual(outcome.delta.geometries, []);
    await client.undo();
    assert.deepEqual(JSON.parse(await client.storageSnapshot()), initial);
    assert.equal(client.state().documentDirty, false);
    assert.equal(client.state().stateRevision, 1);
    await client.redo();
    assert.deepEqual(JSON.parse(await client.storageSnapshot()), expected);
  } finally { client.dispose(); }
});

test('actual Core service metadata and empty import own no-op, checkpoint and small deltas', async () => {
  const client = createNodeCoreDocument();
  try {
    const initial = seed();
    await client.load(JSON.stringify(initial));
    const id = initial.genericFeatures[0].id;
    const before = client.state();
    const unchanged = await client.execute(command('generic.metadata', 'generic', id,
      { id, field: 'name', value: `  ${initial.genericFeatures[0].properties.name}  ` }));
    assert.equal(unchanged.changed, false);
    assert.deepEqual(client.state(), before);
    const changed = await client.execute(command('generic.metadata', 'generic', id, { id, field: 'notes', value: '  Updated  ' }));
    assert.equal(changed.ok, true);
    assert.equal(changed.delta.objects.length, 1);
    assert.equal(changed.state.stateRevision, 1);
    const expected = structuredClone(initial);
    expected.genericFeatures[0].properties.notes = 'Updated';
    assert.deepEqual(JSON.parse(await client.storageSnapshot()), expected);
    const imported = await client.execute({ commandId: 'generic.import', targets: [], payload: { features: [] } });
    assert.equal(imported.changed, true);
    assert.equal(imported.state.checkpoint, 2);
    assert.equal(imported.state.stateRevision, 2);
    assert.deepEqual(imported.delta.objects, []);
    assert.deepEqual(JSON.parse(await client.storageSnapshot()), expected);
    await client.undo();
    assert.equal(client.state().checkpoint, 1);
    assert.deepEqual(JSON.parse(await client.storageSnapshot()), expected);
    await client.undo();
    assert.deepEqual(JSON.parse(await client.storageSnapshot()), initial);
  } finally { client.dispose(); }
});
