import {createGisCoreFixture} from '../helpers/gis-core-fixture.mjs';
import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import { normalizeCountryCollection } from "../../shared/frontend/js/modules/country-feature.js";
import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedCalculationCore } from '../../shared/frontend/js/modules/temporal.js';

import {
  appendImportedSourceInfo,
  applyImportedPackageAssets,
  createCountryImportMergePlanner,
  createGisGeometryValidator,
  createImportService,
} from "../../apps/editor/frontend/js/modules/import-service.js";

test('shared GIS country merge resolves ordered identities and rejects invalid imports', () => {
  assert.deepEqual(sharedCalculationCore.planGisCountryMerge(['A', '이웃', 'A'], ['A', '새 국가']), {
    status: 'valid', matched: 1, existing: [2, -1], unaffected: [1],
  });
  assert.equal(sharedCalculationCore.planGisCountryMerge(['A'], []).status, 'empty');
  assert.equal(sharedCalculationCore.planGisCountryMerge(['A'], ['', 'B']).status, 'invalid-ids');
  assert.equal(sharedCalculationCore.planGisCountryMerge(['A'], ['B', 'B']).status, 'invalid-ids');
});

test('actual country merge rejects empty and duplicate imported IDs before geometry operations', async () => {
  let operations = 0;
  const planner = createCountryImportMergePlanner({
    clipper: { union() { operations++; }, difference() { operations++; }, intersection() { operations++; } },
    clone: structuredClone, featureCountryId: feature => feature.id,
  });
  await assert.rejects(planner({ features: [] }, { features: [] }, 'id-replace'), /병합할 국가 객체가 없습니다/);
  await assert.rejects(planner({ features: [] }, { features: [country('X'), country('X')] }, 'id-replace'), /중복/);
  await assert.rejects(planner({ features: [] }, { features: [country('')] }, 'id-replace'), /비어 있거나 중복/);
  assert.equal(operations, 0);
});

const country = (id, name = id) => ({
  type: 'Feature',
  id,
  properties: { name },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
});

test('project replacement rejects unmarked vectors and preserves current common fields from the Core file receipt', async t => {
  let loaded;
  const target=await createGisCoreFixture([],{platformPorts:{replaceSnapshot:project=>{loaded=project;return true;}}});
  t.after(()=>target.dispose());
  const {state,store:entityStore,committer}=target;
  await assert.rejects(committer.applyImportedReplacement({ countriesData: { features: [country('A')] } }), /저장 정보/);
  assert.equal(state.territorialEntities.length, 0);
  const source=await createGisCoreFixture([createTerritorialFeature({ id: 'A', entityKind: 'general',
      name: '', color: '#123456', geometry: country('A').geometry }),
    createTerritorialFeature({ id: 'S', entityKind: 'general', parentId: 'A',
      geometry: country('A').geometry }),
    createTerritorialFeature({ id: 'R', entityKind: 'regional',
      geometry: country('A').geometry })]);
  t.after(()=>source.dispose());
  const {project:packageState}=await source.project.buildFileSnapshot();
  await committer.applyImportedReplacement({ atlasMetadata: { projectState: packageState } });
  assert.equal(state.territorialEntities[0].properties.name, '');
  assert.equal(state.territorialEntities[0].properties.style.color, '#123456');
  assert.equal(state.territorialEntities[1].properties.parentId, 'A');
  assert.deepEqual(entityStore.identities(), packageState.territorialEntities);
  assert.equal(loaded.baseDataset, packageState.baseDataset);
});

test('GIS geometry validator scopes IDs and resolves worker responses', async () => {
  const messages = [];
  const worker = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      messages.push(message);
      Promise.resolve().then(() => this.onmessage({ data: { ...message, type: 'result', ok: true, result: { overlapAreaKm2: 0 } } }));
    },
    terminate() {},
  };
  const validator = createGisGeometryValidator({ createWorker: () => worker, timeoutMs: 100 });
  const result = await validator.validate({ type: 'FeatureCollection', features: [] }, ['AAA', 'AAA', '']);
  assert.equal(result.overlapAreaKm2, 0);
  assert.deepEqual(messages[0].payload.affectedIds, ['AAA']);
  validator.dispose();
});

test('country merge planner replaces matching IDs without mutating inputs', async () => {
  const current = { type: 'FeatureCollection', features: [country('AAA', 'Old'), country('BBB')] };
  const imported = { type: 'FeatureCollection', features: [country('AAA', 'New')] };
  const planner = createCountryImportMergePlanner({
    clipper: { union() {}, difference() {}, intersection() {} },
    clone: value => JSON.parse(JSON.stringify(value)),
    featureCountryId: feature => feature.id,
    countryName: feature => feature.properties.name,
    geometryBounds: () => [[0, 0], [1, 1]],
    boundsOverlap: () => false,
    normalizeGeometry: value => value,
    geometryCoordinates: geometry => geometry?.coordinates || [],
    planarArea: () => 0,
    areaKm2: () => 0,
    validateCountryCollection: async () => ({ overlapAreaKm2: 0 }),
  });
  const plan = await planner(current, imported, 'id-replace');
  assert.equal(plan.canCommit, true);
  assert.deepEqual(plan.counts, {
    matched: 1,
    added: 0,
    replaced: 1,
    subtracted: 0,
    deleted: 0,
    overlapAreaKm2: 0,
    residualOverlapAreaKm2: 0,
  });
  assert.equal(plan.countriesData.features.find(feature => feature.id === 'AAA').properties.name, 'Old');
  assert.equal(current.features[0].properties.name, 'Old');
});

test('merge planning computes unchanged incoming bounds once per operation and keeps validation order', async () => {
  const visits = [];
  let validations = 0;
  const planner = createCountryImportMergePlanner({
    clipper: { union: (...items) => items[0], difference: left => left, intersection: () => [] },
    clone: structuredClone, featureCountryId: feature => feature.id, countryName: feature => feature.id,
    geometryBounds: geometry => { visits.push(geometry); return [0, 0, 1, 1]; },
    boundsOverlap: () => false,
    normalizeGeometry: coordinates => coordinates.length ? { type: 'Polygon', coordinates } : null,
    geometryCoordinates: geometry => geometry.coordinates, planarArea: () => 0, areaKm2: () => 0,
    validateCountryCollection: async () => { validations++; return { overlapAreaKm2: 0 }; },
  });
  const current = { type: 'FeatureCollection', features: ['A', 'B', 'C'].map(id => country(id)) };
  const incoming = { type: 'FeatureCollection', features: [country('D')] };
  const before = JSON.stringify({ current, incoming });
  for (const strategy of ['id-replace', 'territory-replacement']) {
    visits.length = 0;
    const result = await planner(current, incoming, strategy);
    assert.deepEqual(result.countriesData.features.map(feature => feature.id), ['A', 'B', 'C', 'D']);
    assert.equal(result.canCommit, true);
    assert.equal(visits.length, 4, 'three distinct existing geometries plus one unchanged incoming geometry');
    assert.deepEqual(visits.filter(geometry => current.features.some(feature => feature.geometry === geometry)), current.features.map(feature => feature.geometry));
    assert.equal(JSON.stringify({ current, incoming }), before);
  }
  assert.equal(validations, 1, 'territory replacement retains its final validation');
  visits.length = 0;
  await planner({ features: [] }, incoming, 'id-replace');
  assert.equal(visits.length, 0, 'no speculative bounds work when there are no comparisons');
  // A new operation must recompute changed input; no cross-operation cache.
  current.features[0].geometry.coordinates[0][0][0] = 3;
  visits.length = 0;
  await planner(current, incoming, 'territory-replacement');
  assert.equal(visits.length, 4);
  assert.equal(visits[0].coordinates[0][0][0], 3);
});

test('imported-wins authoritatively replaces the same country instead of unioning its old geometry', async () => {
  const unionArgumentCounts = [];
  const clipper = {
    union(...items) { unionArgumentCounts.push(items.length); return items[0]; },
    difference(left) { return left; },
    intersection() { return []; },
  };
  const current = { type: 'FeatureCollection', features: [country('DEU', 'Old Germany'), country('FRA')] };
  const importedGermany = country('DEU', 'New Germany');
  importedGermany.geometry.coordinates = [[[10, 10], [11, 10], [11, 11], [10, 10]]];
  const planner = createCountryImportMergePlanner({
    clipper,
    clone: value => JSON.parse(JSON.stringify(value)),
    featureCountryId: feature => feature.id,
    countryName: feature => feature.properties.name,
    geometryBounds: geometry => geometry.coordinates.flat(3).reduce((bounds, value, index) => {
      if (index % 2 === 0) { bounds[0][0] = Math.min(bounds[0][0], value); bounds[1][0] = Math.max(bounds[1][0], value); }
      else { bounds[0][1] = Math.min(bounds[0][1], value); bounds[1][1] = Math.max(bounds[1][1], value); }
      return bounds;
    }, [[Infinity, Infinity], [-Infinity, -Infinity]]),
    boundsOverlap: () => false,
    normalizeGeometry: coordinates => Array.isArray(coordinates) && coordinates.length
      ? { type: 'Polygon', coordinates }
      : null,
    geometryCoordinates: geometry => geometry.coordinates,
    planarArea: () => 0,
    areaKm2: () => 0,
    validateCountryCollection: async () => ({ overlapAreaKm2: 0 }),
  });
  const plan = await planner(current, { type: 'FeatureCollection', features: [importedGermany] }, 'imported-wins');
  assert.deepEqual(plan.countriesData.features.find(feature => feature.id === 'DEU').geometry, importedGermany.geometry);
  assert.deepEqual(unionArgumentCounts, [1]);
  assert.equal(current.features.find(feature => feature.id === 'DEU').properties.name, 'Old Germany');
});

test('territory replacement deletes every country fully covered by one historical country', async () => {
  const planner = createCountryImportMergePlanner({
    clipper: {
      union(...items) { return items[0]; },
      difference() { return []; },
      intersection() { return [[[0, 0], [1, 0], [1, 1], [0, 0]]]; },
    },
    clone: value => JSON.parse(JSON.stringify(value)),
    featureCountryId: feature => feature.id,
    countryName: feature => feature.properties.name,
    geometryBounds: () => [[0, 0], [1, 1]],
    boundsOverlap: () => true,
    normalizeGeometry: coordinates => Array.isArray(coordinates) && coordinates.length
      ? { type: 'Polygon', coordinates }
      : null,
    geometryCoordinates: geometry => geometry.coordinates,
    planarArea: () => 1,
    areaKm2: () => 1,
    validateCountryCollection: async () => ({ overlapAreaKm2: 0 }),
  });
  const current = { type: 'FeatureCollection', features: [country('CZE'), country('SVK')] };
  const historical = { type: 'FeatureCollection', features: [country('state:czechoslovakia')] };
  const plan = await planner(current, historical, 'territory-replacement');
  assert.equal(plan.canCommit, true);
  assert.equal(plan.counts.subtracted, 2);
  assert.equal(plan.counts.deleted, 2);
  assert.deepEqual(plan.affectedIds.sort(), ['CZE', 'SVK', 'state:czechoslovakia'].sort());
  assert.deepEqual(plan.donorIds, ['CZE', 'SVK']);
  assert.equal(plan.transferredGeometry.type, 'Polygon');
  assert.deepEqual(plan.countriesData.features.map(feature => feature.id), ['state:czechoslovakia']);
  assert.equal(current.features.length, 2);
});

test('territory replacement preserves the remainders of several partially covered countries', async () => {
  const remainder = [[[0, 0], [0.5, 0], [0.5, 0.5], [0, 0]]];
  const planner = createCountryImportMergePlanner({
    clipper: {
      union(...items) { return items[0]; },
      difference() { return remainder; },
      intersection() { return [[[0, 0], [1, 0], [1, 1], [0, 0]]]; },
    },
    clone: value => JSON.parse(JSON.stringify(value)),
    featureCountryId: feature => feature.id,
    countryName: feature => feature.properties.name,
    geometryBounds: () => [[0, 0], [1, 1]],
    boundsOverlap: () => true,
    normalizeGeometry: coordinates => Array.isArray(coordinates) && coordinates.length
      ? { type: 'Polygon', coordinates }
      : null,
    geometryCoordinates: geometry => geometry.coordinates,
    planarArea: () => 1,
    areaKm2: () => 1,
    validateCountryCollection: async () => ({ overlapAreaKm2: 0 }),
  });
  const current = { type: 'FeatureCollection', features: [country('DEU'), country('POL')] };
  const historical = { type: 'FeatureCollection', features: [country('state:east-prussia')] };
  const plan = await planner(current, historical, 'territory-replacement');
  assert.equal(plan.canCommit, true);
  assert.equal(plan.counts.subtracted, 2);
  assert.equal(plan.counts.deleted, 0);
  assert.deepEqual(plan.donorIds, ['DEU', 'POL']);
  assert.deepEqual(plan.countriesData.features.map(feature => feature.id), [
    'DEU', 'POL', 'state:east-prussia',
  ]);
  assert.deepEqual(plan.countriesData.features[0].geometry.coordinates, remainder);
  assert.deepEqual(plan.countriesData.features[1].geometry.coordinates, remainder);
});

test('historical replacement clips fully transferred dependents in one actual Core commit and Undo unit',async()=>{
  const existing=normalizeCountryCollection({features:[country('KAZ')]}).features[0],replacement=normalizeCountryCollection({features:[country('state:soviet-union')]}).features[0];
  const f=await createGisCoreFixture([existing,createTerritorialFeature({id:'KAB',entityKind:'general',parentId:'KAZ',geometry:existing.geometry})]);
  const before=f.project.snapshot();
  const result=await f.committer.commitGisMerge({countriesData:{type:'FeatureCollection',features:[replacement]},
    landDependentsTargetId:replacement.id,sourceInfo:{title:'Historical library'}},
    {countriesData:{type:'FeatureCollection',features:[replacement]},counts:{added:1,subtracted:1,deleted:1},
      affectedIds:['KAZ',replacement.id],donorIds:['KAZ'],transferredGeometry:replacement.geometry});
  assert.deepEqual(result,{added:1,subtracted:1,deleted:1,affectedIds:['KAZ','state:soviet-union']});
  assert.deepEqual(f.entityRepository.list().map(row=>row.id),[replacement.id]);
  assert.equal(f.entityRepository.get('KAB'),null,'the original difference algorithm removes a fully transferred child');
  assert.equal(f.project.snapshot().sourceInfo.imports[0].title,'Historical library');
  assert.equal(f.client.state().stateRevision,1);assert.deepEqual(f.events,['history','save']);
  const after=f.project.snapshot();assert.equal(await f.project.undo(),true);assert.equal(f.client.state().canUndo,false);
  assert.deepEqual(f.project.snapshot(),before);assert.equal(await f.project.redo(),true);assert.deepEqual(f.project.snapshot(),after);
});

test('import service returns a current immutable entity plan without a retired country merge', async () => {
  const calls = [];
  const result = { targetType: 'general', importPlan: { targetType: 'general' }, collection: { type: 'FeatureCollection', features: [country('AAA')] } };
  const service = createImportService({
    openImportWizard: async (_files, options) => { calls.push(options.targetType); return result; },
    getWizardOptions: () => ({ parentOptions: [] }), validateStructuredGeometry: () => [], getProjectGeneration: () => 7,
  });
  const opened = await service.openFiles([{ name: 'entities.geojson' }], { targetType: 'general' });
  assert.equal(opened.status, 'planned');
  assert.equal(opened.plan.kind, 'territorial');
  assert.equal(opened.plan.projectGeneration, 7);
  assert.deepEqual(opened.plan.payload.result, result);
  assert.ok(Object.isFrozen(opened.plan));
  assert.deepEqual(calls, ['general']);
});

test('GIS imports ignore feature metadata while project packages preserve separate assets and source history', () => {
  const collection = { type: 'FeatureCollection', features: [country('AAA', 'Alpha')] };
  const entities = normalizeCountryCollection(collection).features;
  const restored = applyImportedPackageAssets({
    countryAssets: [{ countryId: 'AAA', mimeType: 'image/png', base64: 'abc' }],
  }, [...entities, normalizeCountryCollection({ features: [country('BBB')] }).features[0]]);
  assert.equal(restored.find(entity => entity.id === 'AAA').properties.metadata.flagDataUrl, 'data:image/png;base64,abc');
  assert.equal(restored.find(entity => entity.id === 'BBB').properties.metadata.flagDataUrl, undefined);
  assert.deepEqual(appendImportedSourceInfo({ id: 'old' }, { id: 'new' }, () => 'now'), {
    mergedAt: 'now',
    imports: [{ id: 'old' }, { id: 'new' }],
  });
});
