import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendImportedSourceInfo,
  applyImportedPackageAssets,
  createCountryImportMergePlanner,
  createGisGeometryValidator,
  createImportService,
  importedCountryOverrides,
} from '../../assets/js/modules/import-service.js';

const country = (id, name = id) => ({
  type: 'Feature',
  id,
  properties: { name },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
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
  assert.deepEqual(importedCountryOverrides(collection), {});
  const restored = applyImportedPackageAssets({
    countryAssets: [{ countryId: 'AAA', mimeType: 'image/png', base64: 'abc' }],
  }, {
    AAA: { flagDataUrl: null },
    BBB: { flagDataUrl: null },
  });
  assert.equal(restored.AAA.flagDataUrl, 'data:image/png;base64,abc');
  assert.equal(restored.BBB.flagDataUrl, null);
  assert.deepEqual(appendImportedSourceInfo({ id: 'old' }, { id: 'new' }, () => 'now'), {
    mergedAt: 'now',
    imports: [{ id: 'old' }, { id: 'new' }],
  });
});
