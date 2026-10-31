import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCoreDocumentReadModel } from "../../shared/frontend/js/modules/core-document-read-model.js";

const seed = () => JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
const emptyDelta = () => ({ objects: [], orders: orders(seed()), geometries: [], removedGeometryRefs: [], timelineRecords: null, presentation: null, provenance: null,header: null });

const fields = { territorial: 'territorialEntities', label: 'labels', hydro: 'hydroEdits', generic: 'genericFeatures',
  distributionLayer: 'distributionLayers', distributionEntry: 'distributionEntries' };
const orders = project => Object.fromEntries(Object.entries(fields).map(([domain, field]) => [domain, project[field].map(row => row.id)]));

test('service queries expose the same immutable accepted domain rows without writable stores', () => {
  const model = createCoreDocumentReadModel(seed());
  for (const [domain, field] of Object.entries(fields)) {
    const rows = model.list(domain);
    assert.equal(rows, model.snapshot()[field]);
    assert.equal(model.get({ domain, id: rows[0].id }), rows[0]);
    assert.equal(model.get({ domain, id: 'missing' }), null);
    assert.throws(() => rows.push(rows[0]), TypeError);
  }
  assert.throws(() => model.list('builtin'), { code: 'PL-CORE-RESPONSE' });
  assert.throws(() => model.get({ domain: 'label', id: null }), { code: 'PL-CORE-RESPONSE' });
});

test('document load replaces the same readonly facade atomically and releases the prior geometry archive and diagnostic', () => {
  const model=createCoreDocumentReadModel(seed()),initial=model.snapshot();
  model.apply({ ...emptyDelta(),provenance: { stale: true } });
  const next=seed();next.territorialEntities[0].properties.name='Loaded replacement';
  next.geometries.push({ id: 'replacement-only',version: 1,geojson: { type: 'Point',coordinates: [1.125,2.25] } });
  const loaded=model.acceptLoadedProject(next);
  assert.equal(model.get({ domain: 'territorial',id: 'A' }),loaded.territorialEntities[0]);
  assert.equal(initial.territorialEntities[0].properties.name,seed().territorialEntities[0].properties.name);
  assert.ok(Object.isFrozen(loaded));assert.equal(model.provenance(),null);
  assert.deepEqual(model.geometry({ id: 'replacement-only',version: 1 }),{ type: 'Point',coordinates: [1.125,2.25] });
  assert.throws(() => model.acceptLoadedProject({ ...next,labels: null }),{ code: 'PL-CORE-RESPONSE' });
  assert.equal(model.snapshot(),loaded);
});

test('accepted replacement reuses equal immutable geometry while rejecting changed coordinates under the same reference', () => {
  const project=seed(), model=createCoreDocumentReadModel(project);
  const row=project.geometries[0],ref={id:row.id,version:row.version},before=model.geometry(ref);
  model.acceptLoadedProject(structuredClone(project));
  assert.strictEqual(model.geometry(ref),before);
  const changed=structuredClone(project);
  const visit=value=>{if(typeof value[0]==='number')value[0]+=.125;else visit(value[0]);};
  visit(changed.geometries[0].geojson.coordinates);
  model.acceptLoadedProject(changed);
  assert.notStrictEqual(model.geometry(ref),before);
});

test('a complete C++ document delta changes only its authoritative object and retains every other domain exactly', () => {
  const project = seed();
  const model = createCoreDocumentReadModel(project);
  const before = model.snapshot();
  const changed = structuredClone(project.territorialEntities[0]); changed.properties.name = 'Beta';
  model.apply({ ...emptyDelta(), objects: [{ ref: { domain: 'territorial', id: changed.id }, value: changed, index: 0 }] });
  const expected = structuredClone(before); expected.territorialEntities[0] = changed;
  assert.deepEqual(model.snapshot(), expected);
  for (const field of ['labels','hydroEdits','genericFeatures','distributionLayers','distributionEntries','layerPresentation','sourceInfo'])
    assert.equal(model.snapshot()[field], before[field], field);
  assert.throws(() => { model.snapshot().genericFeatures[0].properties.name = 'illegal writer'; }, TypeError);
});

test('authoritative vector indices preserve multi-create order independently of delta object ordering', () => {
  const project = seed();
  const model = createCoreDocumentReadModel(project);
  const first = { ...structuredClone(project.labels[0]), id: 'first' }, second = { ...structuredClone(project.labels[0]), id: 'second' };
  const nextOrders = orders(project); nextOrders.label.push('first', 'second');
  model.apply({ ...emptyDelta(), orders: nextOrders, objects: [{ ref: { domain: 'label', id: 'second' }, value: second, index: 2 },
    { ref: { domain: 'label', id: 'first' }, value: first, index: 1 }] });
  assert.deepEqual(model.snapshot().labels.map(row => row.id), [project.labels[0].id, 'first', 'second']);
});

test('whole-project history removal drops obsolete geometry versions and never reorders unrelated content', () => {
  const project = seed();
  const model = createCoreDocumentReadModel(project), before = model.snapshot();
  const entry = { id: 'new-history-version', version: 1, geojson: { type: 'Point', coordinates: [5.125,6.25] } };
  model.apply({ ...emptyDelta(), geometries: [entry] });
  assert.ok(model.geometry({ id: entry.id, version: 1 }));
  model.apply({ ...emptyDelta(), removedGeometryRefs: [{ id: entry.id, version: 1 }] });
  assert.equal(model.geometry({ id: entry.id, version: 1 }), null);
  assert.deepEqual(model.snapshot(), before);
});

test('a canonical archive delta can re-admit an existing identical version without duplicating or reallocating it', () => {
  const project=seed(),model=createCoreDocumentReadModel(project),entry=project.geometries[0];
  const before=model.geometry({ id: entry.id,version: entry.version }), snapshot=model.snapshot();
  model.apply({ ...emptyDelta(),geometries: [structuredClone(entry)] });
  assert.equal(model.geometry({ id: entry.id,version: entry.version }),before);
  assert.deepEqual(model.snapshot(),snapshot);
  const changed={ ...entry,geojson: { type: 'Point',coordinates: [99.125,88.25] } },accepted=model.snapshot();
  assert.throws(() => model.apply({ ...emptyDelta(),geometries: [changed] }),{ code: 'PL-CORE-RESPONSE' });
  assert.equal(model.snapshot(),accepted);
  assert.throws(() => model.apply({ ...emptyDelta(),geometries: [entry,entry] }),{ code: 'PL-CORE-RESPONSE' });
  assert.equal(model.snapshot(),accepted);
  const signed=seed();signed.geometries[0].geojson={ type: 'Point',coordinates: [0,6] };
  const exact=createCoreDocumentReadModel(signed);
  assert.throws(() => exact.apply({ ...emptyDelta(),geometries: [{ ...signed.geometries[0],
    geojson: { type: 'Point',coordinates: [-0,6] } }] }),{ code: 'PL-CORE-RESPONSE' });
});

test('authoritative domain order can reorder existing rows while provenance remains outside stored JSON', () => {
  const project = seed();
  const model = createCoreDocumentReadModel(project), before = model.snapshot();
  const nextOrders = orders(project); nextOrders.territorial.reverse();
  const provenance = { originalArchive: [], inlineAllocations: [], opaqueUncertain: false };
  model.apply({ ...emptyDelta(), orders: nextOrders, provenance });
  const expected = structuredClone(before); expected.territorialEntities.reverse();
  assert.deepEqual(model.snapshot(), expected);
  assert.deepEqual(model.provenance(), provenance);
  assert.ok(Object.isFrozen(model.provenance()));
  assert.equal(model.snapshot().labels, before.labels);
  assert.equal(Object.hasOwn(model.snapshot(), 'originalArchive'), false);
});

test('an incomplete authoritative order rejects the entire delta without publishing any read state', () => {
  const project = seed(), model = createCoreDocumentReadModel(project), before = model.snapshot();
  const nextOrders = orders(project); nextOrders.territorial.pop();
  assert.throws(() => model.apply({ ...emptyDelta(), orders: nextOrders, provenance: { changed: true } }), { code: 'PL-CORE-RESPONSE' });
  assert.equal(model.snapshot(), before);
  assert.equal(model.provenance(), null);
});

test('current document world rows share immutable authoritative identities/archive without another writable timeline source', () => {
  const model = createCoreDocumentReadModel(seed()), initial = model.snapshot();
  const row = { objectRef: { domain: 'territorial', id: 'A' }, geometryRef: { id: 'shape', version: 1 }, parentId: '', coverageMode: 'explicit',
    validFrom: null, validTo: null, rootId: 'A', ancestors: [], properties: {} };
  const raw = { month: '1914-07', sourceEpoch: 7, entities: [row] };
  const world = model.projectWorld(raw, 7);
  assert.equal(world.entities[0].identity, initial.territorialEntities[0]);
  assert.equal(world.entities[0].geometry, model.geometry(row.geometryRef));
  assert.equal(world.byId.get('A'), world.entities[0]);
  assert.equal(Object.hasOwn(world.byId, 'set'), false);
  row.geometryRef.version = 999;
  assert.equal(world.entities[0].geometryRef.version, 1);
  assert.throws(() => { world.entities[0].identity.properties.name = 'illegal writer'; }, TypeError);
  const changed = structuredClone(initial.territorialEntities[0]); changed.properties.name = 'Accepted name';
  model.apply({ ...emptyDelta(), objects: [{ ref: { domain: 'territorial', id: 'A' }, value: changed, index: 0 }] });
  const next = model.projectWorld({ ...raw, sourceEpoch: 8, entities: [{ ...row, geometryRef: { id: 'shape', version: 1 } }] },8);
  assert.equal(next.byId.get('A').identity.properties.name, 'Accepted name');
  assert.equal(next.byId.get('A').geometry, world.byId.get('A').geometry);
});

test('world projection rejects stale epochs and invalid refs without modifying the accepted document', () => {
  const model = createCoreDocumentReadModel(seed()), before = model.snapshot();
  assert.throws(() => model.projectWorld({ month: '1914-07', sourceEpoch: 1, entities: [] },2), { code: 'PL-CORE-STALE' });
  assert.throws(() => model.projectWorld({ month: '1914-07', sourceEpoch: 2, entities: [{ objectRef: { domain: 'territorial', id: 'missing' }, geometryRef: { id: 'absent', version: 1 } }] },2),
    { code: 'PL-CORE-RESPONSE' });
  assert.equal(model.snapshot(), before);
});

test('accepted metadata acknowledgements reproject current C++ rows while retaining unchanged view and geometry allocations', () => {
  const initial=seed(),model=createCoreDocumentReadModel(initial);
  const rows=['A','B'].map(id => ({ objectRef: { domain: 'territorial', id },geometryRef: { id: 'shape',version: 1 },parentId: '',coverageMode: 'explicit',
    validFrom: null,validTo: null,rootId: id,ancestors: [],properties: {} }));
  model.acceptTransition({ state: { epoch: 1 },project: initial,world: { month: '1914-07',sourceEpoch: 1,entities: rows } },'core.document-load');
  const before=model.territorialViews(),changed=structuredClone(initial.territorialEntities[0]);changed.properties.name='Accepted rename';
  model.acceptTransition({ state: { epoch: 2 },delta: { ...emptyDelta(),objects: [
    { ref: { domain: 'territorial',id: 'A' },value: changed,index: 0 },
  ] } },'core.document-execute');
  const after=model.territorialViews();
  assert.equal(after[0].properties.name,'Accepted rename');assert.equal(before[0].properties.name,initial.territorialEntities[0].properties.name);
  assert.equal(after[1],before[1]);assert.equal(after[0].geometry,before[0].geometry);
  assert.equal(model.world().sourceEpoch,2);assert.ok(Object.isFrozen(after[0].properties));
  assert.throws(() => model.acceptTransition({ state: { epoch: 3 },delta: { ...emptyDelta(),timelineRecords: initial.timelineRecords } },
    'core.document-confirm'),{ code: 'PL-CORE-RESPONSE' });
});

test('authoritative header patches preserve explicit null and missing fields without admitting a second domain writer',() => {
  const model=createCoreDocumentReadModel(seed()),before=model.snapshot();
  model.apply({ ...emptyDelta(),presentation: { physicalSettings: { hiddenHydroIds: { source: true } } },header: { set: { sourceInfo: null },removedKeys: ['physicalSourceInfo'] } });
  const accepted=model.snapshot();assert.ok(Object.hasOwn(accepted,'sourceInfo'));assert.equal(accepted.sourceInfo,null);
  assert.equal(Object.hasOwn(accepted,'physicalSourceInfo'),false);assert.equal(accepted.labels,before.labels);
  assert.deepEqual(accepted.physicalSettings.hiddenHydroIds,{ source: true });
  assert.throws(() => model.apply({ ...emptyDelta(),header: { set: { physicalSettings: {} },removedKeys: [] } }),{ code: 'PL-CORE-RESPONSE' });
  assert.throws(() => model.apply({ ...emptyDelta(),header: { set: { labels: [] },removedKeys: [] } }),{ code: 'PL-CORE-RESPONSE' });
  assert.throws(() => model.apply({ ...emptyDelta(),header: { set: { sourceInfo: null },removedKeys: ['sourceInfo'] } }),{ code: 'PL-CORE-RESPONSE' });
  assert.equal(model.snapshot(),accepted);
});

test('a retained C++ candidate projects immutable preview rows without publishing document, world or archive changes',() => {
  const model=createCoreDocumentReadModel(seed()),before=model.snapshot(),row={ objectRef: { domain: 'territorial', id: 'A' },geometryRef: { id: 'shape',version: 1 },
    parentId: '',coverageMode: 'explicit',validFrom: null,validTo: null,rootId: 'A',ancestors: [],properties: {} },world={ month: '1914-07',sourceEpoch: 1,entities: [row] };
  model.acceptWorld(world,1);const currentWorld=model.world(),currentViews=model.territorialViews();
  const value=structuredClone(before.territorialEntities[0]);value.properties.name='Prepared only';
  const native={ delta: { ...emptyDelta(),objects: [{ ref: { domain: 'territorial',id: 'A' },value,index: 0 }] },world };
  model.acceptTransition(native,'core.document-candidate-projection');assert.equal(model.snapshot(),before);
  const preview=model.candidateProjection(native,1);
  assert.equal(preview.territorialViews[0].properties.name,'Prepared only');
  assert.equal(preview.territorialViews[0].geometry,currentViews[0].geometry);assert.ok(Object.isFrozen(preview.territorialViews[0]));
  assert.equal(model.snapshot(),before);assert.equal(model.world(),currentWorld);assert.equal(model.territorialViews(),currentViews);
  assert.throws(() => model.candidateProjection(native,2),{ code: 'PL-CORE-STALE' });assert.equal(model.snapshot(),before);
});
