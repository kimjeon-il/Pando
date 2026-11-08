import { describe as contractSuite } from 'node:test';
import * as __core_dep0 from "node:assert/strict";
import * as __core_dep1 from "node:fs";
import * as __core_dep2 from "node:test";
import * as __core_dep3 from "../../helpers/core-session.mjs";
import * as __core_dep4 from "../../../src/document/core-document-read-model.js";
import * as __core_dep5 from "../../helpers/web-oracle.mjs";

// Initialize the original Web source oracle at module scope, before synchronous suites.
const __coreContentOracle = await __core_dep5.loadWebOracle('assets/js/modules/generic-feature-service.js');
contractSuite("core-document-wasm", () => {
const assert = __core_dep0.default;
const { readFileSync } = __core_dep1;
const test = __core_dep2.default;
const { createNodeCoreDocument } = __core_dep3;
const { createCoreDocumentReadModel } = __core_dep4;

const seed = () => JSON.parse(readFileSync(new URL("../../fixtures/portability/web-document-seed.json", import.meta.url), 'utf8'));
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
});
contractSuite("core-document-content-wasm", () => {
const assert = __core_dep0.default;
const { readFileSync } = __core_dep1;
const test = __core_dep2.default;
const { createNodeCoreDocument } = __core_dep3;
const { loadWebOracle } = __core_dep5;

const { normalizeGenericFeatureSemantics } = __coreContentOracle;
const seed = () => JSON.parse(readFileSync(new URL("../../fixtures/portability/web-document-seed.json", import.meta.url), 'utf8'));
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
});
