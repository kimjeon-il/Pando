import { createTerritorialFeature, normalizeTerritorialEntities } from '../../assets/js/modules/territorial-units.js';
import { normalizeCountryCollection } from '../../assets/js/modules/country-feature.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendImportedSourceInfo,
  applyImportedPackageAssets,
  createCountryImportMergePlanner,
  createGisGeometryValidator,
  createImportService,
} from '../../assets/js/modules/import-service.js';
import { createGisImportTransactionCommitter } from '../../assets/js/modules/gis-import-transaction.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createProjectSerializer } from '../../assets/js/modules/project-serializer.js';
import { createProjectDomain } from '../../assets/js/modules/project-domain.js';
import { assertCurrentProjectSchema, applyProjectFields } from '../../assets/js/modules/project-state.js';
import { normalizeLayerPresentation } from '../../assets/js/modules/layer-presentation.js';

const country = (id, name = id) => ({
  type: 'Feature',
  id,
  properties: { name },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
});

test('raw GIS replacement creates a current full project; package replacement preserves common fields', async () => {
  const state = { territorialEntities: [], historyDirtyEntityIds: new Set() };
  const entityStore = createTerritorialEntityStore({ getState: () => state });
  const projectFields = applyProjectFields({}, {}, {
    normalizers: { layerPresentation: normalizeLayerPresentation },
  });
  const serializer = createProjectSerializer({ appVersion: '0.34.0', baseDataset: 'builtin',
    distributionModes: ['territorial', 'geometry'], readSnapshot: () => ({
      territorialEntities: state.territorialEntities, projectFields,
    }) });
  let loaded;
  const projectDomain = createProjectDomain({ serializer, replaceSnapshot: project => {
    assertCurrentProjectSchema(project);
    entityStore.replaceEntities(project.territorialEntities);
    loaded = project;
    return true;
  } });
  const committer = createGisImportTransactionCommitter({ state, entityStore,
    territorialEntityRepository: createTerritorialEntityRepository({ entityStore }),
    projectDomain, normalizeTerritorialEntities, applyImportedPackageAssets, setActionStatus() {},
  });
  await committer.applyImportedReplacement({ countriesData: { features: [country('A')] },
    sourceInfo: { title: 'Raw GIS' } });
  assert.equal(loaded.schemaVersion, 8);
  assert.equal(loaded.baseDataset, 'external-territorial-entities');
  assert.equal(loaded.distributionEntries.length, 0);
  assert.deepEqual(loaded.sourceInfo, { title: 'Raw GIS' });
  assert.equal(state.territorialEntities[0].properties.entityKind, 'general');

  const packageState = serializer.buildProject({ fullAutosave: true, projectFields,
    territorialEntities: [createTerritorialFeature({ id: 'A', entityKind: 'general',
      name: '', color: '#123456', geometry: state.territorialEntities[0].geometry }),
    createTerritorialFeature({ id: 'S', entityKind: 'general', parentId: 'A',
      geometry: state.territorialEntities[0].geometry }),
    createTerritorialFeature({ id: 'R', entityKind: 'regional',
      geometry: state.territorialEntities[0].geometry })],
  });
  await committer.applyImportedReplacement({ atlasMetadata: { projectState: packageState } });
  assert.equal(state.territorialEntities[0].properties.name, '');
  assert.equal(state.territorialEntities[0].properties.style.color, '#123456');
  assert.equal(state.territorialEntities[1].properties.parentId, 'A');
  assert.deepEqual(state.territorialEntities, packageState.territorialEntities);
  assert.equal(loaded.baseDataset, 'external-territorial-entities');
});

test('GIS geometry validator scopes IDs and resolves worker responses', async () => {
  const messages = [];
  const worker = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      messages.push(message);
      Promise.resolve().then(() => this.onmessage({ data: { id: message.id, ok: true, overlapAreaKm2: 0 } }));
    },
    terminate() {},
  };
  const validator = createGisGeometryValidator({ createWorker: () => worker, timeoutMs: 100 });
  const result = await validator.validate({ type: 'FeatureCollection', features: [] }, ['AAA', 'AAA', '']);
  assert.equal(result.overlapAreaKm2, 0);
  assert.deepEqual(messages[0].affectedIds, ['AAA']);
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
  const historical = { type: 'FeatureCollection', features: [country('historical-country:czechoslovakia')] };
  const plan = await planner(current, historical, 'territory-replacement');
  assert.equal(plan.canCommit, true);
  assert.equal(plan.counts.subtracted, 2);
  assert.equal(plan.counts.deleted, 2);
  assert.deepEqual(plan.affectedIds.sort(), ['CZE', 'SVK', 'historical-country:czechoslovakia'].sort());
  assert.deepEqual(plan.donorIds, ['CZE', 'SVK']);
  assert.equal(plan.transferredGeometry.type, 'Polygon');
  assert.deepEqual(plan.countriesData.features.map(feature => feature.id), ['historical-country:czechoslovakia']);
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
  const historical = { type: 'FeatureCollection', features: [country('historical-country:east-prussia')] };
  const plan = await planner(current, historical, 'territory-replacement');
  assert.equal(plan.canCommit, true);
  assert.equal(plan.counts.subtracted, 2);
  assert.equal(plan.counts.deleted, 0);
  assert.deepEqual(plan.donorIds, ['DEU', 'POL']);
  assert.deepEqual(plan.countriesData.features.map(feature => feature.id), [
    'DEU', 'POL', 'historical-country:east-prussia',
  ]);
  assert.deepEqual(plan.countriesData.features[0].geometry.coordinates, remainder);
  assert.deepEqual(plan.countriesData.features[1].geometry.coordinates, remainder);
});

test('historical replacement commits full country deletion and transfers dependent territories atomically', async () => {
  const existing = country('KAZ');
  const replacement = country('historical-country:soviet-union');
  const state = {
    territorialEntities: [normalizeCountryCollection({ features: [existing] }).features[0],
      createTerritorialFeature({ id: 'KAB', unitType: 'subunit', parentId: 'KAZ', geometry: existing.geometry })],
    territorialRelations: [], distributionLayers: [], distributionEntries: [], labels: [], genericFeatures: [],
    itemVisibility: {}, labelSettings: {}, sourceInfo: null,
  };
  let transferred = null;
  let committedSnapshot = null;
  const fixtureEntityStore1 = createTerritorialEntityStore({ getState: () => state });
  const committer = createGisImportTransactionCommitter({
    state,
    entityStore: fixtureEntityStore1, territorialEntityRepository: createTerritorialEntityRepository({ entityStore: fixtureEntityStore1 }),
    deepClone: value => JSON.parse(JSON.stringify(value)),
    normalizeCountryCollection,
    applyImportedPackageAssets,
    validateGisCountryCollection: async () => ({ overlapAreaKm2: 0 }),
    transferLandDependents: (geometry, donorIds, targetId) => {
      transferred = { geometry, donorIds, targetId };
      const child = fixtureEntityStore1.snapshot().find(entity => entity.id === 'KAB');
      fixtureEntityStore1.applyChanges({ features: [{ ...child, properties: { ...child.properties, parentId: targetId } }] });
    },
    pruneLayerItemVisibility() {},
    assertProjectReferenceIntegrity(input) {
      assert.deepEqual(input.territorialEntities.filter(entity => entity.properties.unitType === 'country').map(feature => feature.id), ['historical-country:soviet-union']);
      assert.equal(input.territorialEntities.find(entity => entity.id === 'KAB').properties.parentId, replacement.id);
    },
    snapshotEditable: () => ({ marker: 'before' }),
    restoreEditTransactionSnapshot() { throw new Error('unexpected rollback'); },
    appendImportedSourceInfo: (_previous, next) => next,
    scheduleCountryLabelAnchors() {},
    markCountryGeometriesChanged() {},
    commitHistorySnapshot(snapshot) { committedSnapshot = snapshot; },
    selectionUiController: { clear() {} },
    renderingDomain: { invalidateCountryPatch() {} },
    queueAutosave() {},
    setActionStatus() {},
  });
  const result = await committer.commitGisMerge({
    countriesData: { type: 'FeatureCollection', features: [replacement] },
    landDependentsTargetId: replacement.id,
    sourceInfo: { title: 'Historical library' },
  }, {
    countriesData: { type: 'FeatureCollection', features: [replacement] },
    counts: { added: 1, subtracted: 1, deleted: 1 },
    affectedIds: ['KAZ', replacement.id], donorIds: ['KAZ'], transferredGeometry: replacement.geometry,
  });
  assert.deepEqual(result, {
    added: 1, subtracted: 1, deleted: 1, affectedIds: ['KAZ', 'historical-country:soviet-union'],
  });
  assert.equal(transferred.targetId, replacement.id);
  assert.deepEqual(transferred.donorIds, ['KAZ']);
  assert.deepEqual(state.territorialEntities.map(feature => feature.id), ['KAB', replacement.id]);
  assert.equal(state.territorialEntities.find(entity => entity.id === 'KAB').properties.parentId, replacement.id);
  assert.deepEqual(committedSnapshot, { marker: 'before' });
});

test('import service validates countries and returns one immutable merge plan', async () => {
  const calls = [];
  const result = {
    targetType: 'country',
    importPlan: { targetType: 'country' },
    openMode: 'merge',
    mergeStrategy: 'id-replace',
    countriesData: { type: 'FeatureCollection', features: [country('AAA')] },
  };
  const service = createImportService({
    openImportWizard: async (_files, options) => { calls.push(['wizard', options.targetType]); return result; },
    getWizardOptions: () => ({ countryOptions: [] }),
    validateStructuredGeometry: () => [],
    featureCountryId: feature => feature.id,
    validateCountryCollection: async (_collection, ids) => { calls.push(['validate', [...ids]]); return { overlapAreaKm2: 0 }; },
    getCurrentCountries: () => ({ type: 'FeatureCollection', features: [] }),
    planCountryMerge: async () => ({ canCommit: true, counts: { residualOverlapAreaKm2: 0 } }),
    getProjectGeneration: () => 7,
  });
  const opened = await service.openFiles([{ name: 'countries.geojson' }], { targetType: 'country' });
  assert.equal(opened.status, 'planned');
  assert.equal(opened.plan.kind, 'country-merge');
  assert.equal(opened.plan.projectGeneration, 7);
  assert.equal(opened.plan.payload.plan.canCommit, true);
  assert.deepEqual(calls, [['wizard', 'country'], ['validate', ['AAA']]]);
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
