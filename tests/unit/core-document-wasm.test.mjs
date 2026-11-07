import { describe as contractSuite } from 'node:test';
import * as __core_dep0 from "node:assert/strict";
import * as __core_dep1 from "node:fs";
import * as __core_dep2 from "node:test";
import * as __core_dep3 from "../helpers/core-session.mjs";
import * as __core_dep4 from "../../shared/frontend/js/modules/core-document-read-model.js";
import * as __core_dep5 from "../helpers/web-oracle.mjs";

// Initialize the original Web source oracle at module scope, before synchronous suites.
const __coreContentOracle = await __core_dep5.loadWebOracle('assets/js/modules/generic-feature-service.js');

// Original feature contract: core-document-wasm.test.mjs
contractSuite("core-document-wasm", () => {
const assert = __core_dep0.default;
const { readFileSync } = __core_dep1;
const test = __core_dep2.default;
const { createNodeCoreDocument } = __core_dep3;
const { createCoreDocumentReadModel } = __core_dep4;

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
});

// Original feature contract: core-document-content-wasm.test.mjs
contractSuite("core-document-content-wasm", () => {
const assert = __core_dep0.default;
const { readFileSync } = __core_dep1;
const test = __core_dep2.default;
const { createNodeCoreDocument } = __core_dep3;
const { loadWebOracle } = __core_dep5;

const { normalizeGenericFeatureSemantics } = __coreContentOracle;
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
});

// Original feature contract: core-document-draft-wasm.test.mjs
contractSuite("core-document-draft-wasm", () => {
const assert = __core_dep0.default;
const { readFileSync } = __core_dep1;
const test = __core_dep2.default;
const { createNodeCoreDocument } = __core_dep3;

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
});
