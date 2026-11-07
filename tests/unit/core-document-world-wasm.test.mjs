import { describe as featureDescribe } from 'node:test';
import * as __suiteDependency0 from "node:assert/strict";
import * as __suiteDependency1 from "node:fs";
import * as __suiteDependency2 from "node:test";
import * as __suiteDependency3 from "../helpers/core-session.mjs";
import * as __suiteDependency4 from "../../shared/frontend/js/modules/core-document-read-model.js";
import * as __suiteDependency5 from "node:assert/strict";
import * as __suiteDependency6 from "node:fs";
import * as __suiteDependency7 from "node:test";
import * as __suiteDependency8 from "../helpers/core-session.mjs";
import * as __suiteDependency9 from "node:assert/strict";
import * as __suiteDependency10 from "node:fs";
import * as __suiteDependency11 from "node:test";
import * as __suiteDependency12 from "../helpers/core-session.mjs";
import * as __suiteDependency13 from "node:assert/strict";
import * as __suiteDependency14 from "node:fs";
import * as __suiteDependency15 from "node:test";
import * as __suiteDependency16 from "../helpers/core-session.mjs";
import * as __suiteDependency17 from "../helpers/opaque-flag-expectations.mjs";
import * as __suiteDependency18 from "node:assert/strict";
import * as __suiteDependency19 from "node:fs";
import * as __suiteDependency20 from "node:test";
import * as __suiteDependency21 from "../helpers/core-session.mjs";
import * as __suiteDependency22 from "node:assert/strict";
import * as __suiteDependency23 from "node:test";
import * as __suiteDependency24 from "../../shared/frontend/js/modules/project-session.js";
import * as __suiteDependency25 from "../../shared/frontend/js/modules/layer-presentation.js";
import * as __suiteDependency26 from "../helpers/core-session.mjs";
import * as __suiteDependency27 from "../../shared/frontend/js/modules/core-document-read-model.js";
import * as __suiteDependency28 from "../../shared/frontend/js/modules/territorial-entity-store.js";

// Original feature contract: core-document-world-wasm.test.mjs
featureDescribe("core-document-world-wasm", () => {
  const assert = __suiteDependency0.default;
  const {  readFileSync  } = __suiteDependency1;
  const test = __suiteDependency2.default;
  const {  createNodeCoreDocument  } = __suiteDependency3;
  const {  createCoreDocumentReadModel  } = __suiteDependency4;
test('the whole document Worker preserves every semantic world field and distinct query/cursor precision contracts', async () => {
  const input = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json',import.meta.url),'utf8'));
  const corpus = JSON.parse(readFileSync(new URL('../fixtures/portability/web-timeline-read-model.json',import.meta.url),'utf8'));
  const model = createCoreDocumentReadModel(input), client = createNodeCoreDocument();
  try {
    await client.load(JSON.stringify(input));
    const state = client.state();
    assert.equal(typeof state.timelineCursor, 'string', 'C++ chooses the initial month from the explicit UTC clock input.');
    for (const row of corpus.cases) {
      const world = model.projectWorld(await client.resolveWorld(row.month),client.state().epoch);
      assert.equal(world.month, row.month); assert.equal(world.sourceEpoch, state.epoch);
      // The frozen semantic rows predate explicit object identity and rendering DTO fields.
      const expected = row.expected.map(entity => ({ ...entity,
        objectRef: { domain: 'territorial', id: entity.id }, rendering: {} }));
      assert.deepEqual(world.entities, expected, row.month);
      for (const entity of world.entities) {
        assert.equal(world.byId.get(entity.id),entity);
        assert.equal(entity.geometry,model.geometry(entity.geometryRef));
        assert.equal(entity.identity,model.snapshot().territorialEntities.find(value => value.id === entity.id));
      }
      assert.deepEqual(client.state(),state, 'Queries cannot create dirty/history/revision changes.');
    }
    // Queries accept source precision; navigation still requires a month.
    // The fixture's July 1914 state remains unchanged through the year end.
    const year = model.projectWorld(await client.resolveWorld('1914'),state.epoch);
    assert.equal(year.month,'1914');assert.equal(year.sourceEpoch,state.epoch);
    assert.deepEqual(year.entities,corpus.cases.find(row=>row.month==='1914-07').expected.map(entity=>({
      ...entity,objectRef:{domain:'territorial',id:entity.id},rendering:{},
    })));
    await assert.rejects(client.setTimelineCursor('1914'), { code: 'INVALID_TIMELINE_CURSOR' });
    await assert.rejects(client.resolveWorld('1914-13'), { code: 'PL-TEMPORAL-001' });
    await assert.rejects(client.resolveWorld('0000-01'), { code: 'PL-TEMPORAL-001' });
    assert.deepEqual(client.state(),state,'Read queries and rejected cursor/calendar input preserve the complete session state.');
  } finally { client.dispose(); }
});
});
// Original feature contract: core-document-batch-wasm.test.mjs
featureDescribe("core-document-batch-wasm", () => {
  const assert = __suiteDependency5.default;
  const {  readFileSync  } = __suiteDependency6;
  const test = __suiteDependency7.default;
  const {  createNodeCoreDocument  } = __suiteDependency8;
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
});
// Original feature contract: core-document-field-wasm.test.mjs
featureDescribe("core-document-field-wasm", () => {
  const assert = __suiteDependency9.default;
  const {  readFileSync  } = __suiteDependency10;
  const test = __suiteDependency11.default;
  const {  createNodeCoreDocument  } = __suiteDependency12;
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
});
// Original feature contract: core-document-flag-wasm.test.mjs
featureDescribe("core-document-flag-wasm", () => {
  const assert = __suiteDependency13.default;
  const {  readFileSync  } = __suiteDependency14;
  const test = __suiteDependency15.default;
  const {  createNodeCoreDocument  } = __suiteDependency16;
  const {  currentOpaqueFlagExpectations  } = __suiteDependency17;
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
});
// Original feature contract: core-document-view-selection-wasm.test.mjs
featureDescribe("core-document-view-selection-wasm", () => {
  const assert = __suiteDependency18.default;
  const {  readFileSync  } = __suiteDependency19;
  const test = __suiteDependency20.default;
  const {  createNodeCoreDocument  } = __suiteDependency21;
const input = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8'));
const B = { domain: 'territorial', type: 'entity', id: 'B' };
const empty = { selectionRevision: 0, hoverRevision: 0, items: [], primary: null, hover: null };

test('current-view admission and cursor pruning are published atomically by the actual document Worker', async () => {
  const client = createNodeCoreDocument();
  try {
    await client.load(JSON.stringify(input));
    const inactive = await client.setTimelineCursor('1930-01');
    assert.equal(inactive.world.entities.some(row => row.objectRef.id === 'B'), false,
      'B has no active lifetime in this view.');
    assert.deepEqual(await client.selectionApply({ action: 'replace', ref: B }), { selection: empty, countNoOp: true });
    assert.deepEqual(await client.selectionApply({ action: 'setHover', ref: B, source: 'map' }),
      { selection: empty, countNoOp: true });

    const active = await client.setTimelineCursor('1914-07');
    assert.equal(active.world.entities.some(row => row.objectRef.id === 'B'), true);
    await client.selectionApply({ action: 'replace', ref: B });
    await client.selectionApply({ action: 'setHover', ref: B, source: 'map' });
    assert.deepEqual(await client.selectionSnapshot(), {
      selectionRevision: 1, hoverRevision: 1, items: [B], primary: B, hover: B,
    });

    const cursor = await client.setTimelineCursor('1930-01');
    const expected = { ...empty, selectionRevision: 2, hoverRevision: 2 };
    assert.deepEqual(cursor.selection, expected, 'Cursor ack must contain final selection+hover before the UI publishes this view.');
    assert.deepEqual(await client.selectionSnapshot(), expected);
    assert.equal(client.state().stateRevision, 0);
    assert.equal(client.state().dirty, false);
    assert.equal(client.state().canUndo, false);
  } finally { client.dispose(); }
});
});
// Original feature contract: core-empty-document-wasm.test.mjs
featureDescribe("core-empty-document-wasm", () => {
  const assert = __suiteDependency22.default;
  const test = __suiteDependency23.default;
  const {  createProjectSession  } = __suiteDependency24;
  const {  normalizeLayerPresentation  } = __suiteDependency25;
  const {  createNodeCoreDocument  } = __suiteDependency26;
  const {  createCoreDocumentReadModel  } = __suiteDependency27;
  const {  createTerritorialEntityStore  } = __suiteDependency28;
test('the application startup seed is a complete empty current-format input accepted by the same C++ document owner',async () => {
  const session=createProjectSession();session.connect({ readiness: { DATA_READINESS: { PREVIEW: 'preview' } },
    applicationConstantsA: { DISTRIBUTION_RENDER_MODES: { OVERLAP: 'overlap' } },modelValidation: { normalizeLayerPresentation },
    physicalConfig: { PHYSICAL_DATASET: 'fixture' },domains: {},
    uiFactoriesA: { createAtomicMapStateController: () => ({}) },
    platformConfigurationA: { APP_VERSION: '0.34.0',BASE_DATASET: 'fixture',HYDRO_DATASET: 'fixture-hydro' },
    platformConfigurationB: { TERRAIN_DATASET: 'fixture-terrain' } });
  session.initializeMapWorkScheduler();
  const input=session.initialDocument(),model=createCoreDocumentReadModel(input),client=createNodeCoreDocument({
    onTransition: (result,operation) => model.acceptTransition(result,operation),
  });
  const store=createTerritorialEntityStore({ documentModel: model,commandOwner: client });
  try {
    const accepted=await client.load(JSON.stringify(input));
    assert.deepEqual(JSON.parse(await client.storageSnapshot()),input);assert.deepEqual(accepted.world.entities,[]);
    assert.deepEqual(accepted.selection.items,[]);assert.equal(accepted.draft.active,false);
    assert.equal(accepted.state.dirty,false);assert.equal(accepted.state.canUndo,false);assert.equal(accepted.state.stateRevision,0);
    assert.equal(Object.hasOwn(input,'projection'),false);assert.equal(Object.hasOwn(input,'view'),false);
    assert.notEqual(input.labels,session.state.labels);assert.notEqual(input.layerVisibility,session.state.layerVisibility);
    session.installDocumentProjection({ documentModel: model,commandOwner: client,entityStore: store });
    assert.equal(session.state.labels,model.list('label'));assert.equal(session.state.territorialEntities,model.territorialViews());
    assert.equal(session.state.geometries.snapshot(),model.snapshot().geometries);
    assert.equal(Object.hasOwn(session.state.geometries,'insert'),false);
    assert.throws(() => { session.state.labels=[]; },TypeError);
    session.applyViewingPresentation({action:'visibility',key:'objects',visible:false});
    assert.equal(session.state.layerVisibility.objects,false);assert.deepEqual(JSON.parse(await client.storageSnapshot()),input);assert.equal(client.state().dirty,false);
    assert.throws(() => { session.state.stateRevision=9; },TypeError);
    assert.equal(session.state.stateRevision,client.state().stateRevision);
    assert.equal(session.state.timelineCursor,client.state().timelineCursor);
    assert.throws(() => session.installDocumentProjection({ documentModel: model,commandOwner: client,entityStore: store }),/already installed/);
  } finally { store.dispose();client.dispose(); }
});
});
