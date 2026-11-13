import assert from 'node:assert/strict';
import test from 'node:test';
import {sharedCalculationCore} from '../../../src/document/temporal.js';
import {createGisGeometryValidator} from "../../../tools/gis/gis-geometry-validator.js";
import {createCountryImportMergePlanner} from "../../../tools/gis/country-import-merge.js";

test('shared GIS country merge resolves ordered identities and rejects invalid imports', () => {
  assert.deepEqual(sharedCalculationCore.planGisCountryMerge(['A', '이웃', 'A'], ['A', '새 국가']), {
    status: 'valid', matched: 1, existing: [2, -1], unaffected: [1],
  });
  assert.equal(sharedCalculationCore.planGisCountryMerge(['A'], []).status, 'empty');
  assert.equal(sharedCalculationCore.planGisCountryMerge(['A'], ['', 'B']).status, 'invalid-ids');
  assert.equal(sharedCalculationCore.planGisCountryMerge(['A'], ['B', 'B']).status, 'invalid-ids');
});

test('shared GIS geometry plan preserves candidate order and only subtracts significant overlaps', () => {
  const calls = [];
  let current = -1;
  const result = sharedCalculationCore.planGisCountryGeometry(1, [0, 1, 2], false, {
    prepare() { calls.push('union'); },
    bounds(incoming, country) { calls.push(`bounds:${incoming}:${country}`); return country !== 0; },
    intersection(incoming, country) { calls.push(`intersection:${incoming}:${country}`); current = country; return country === 1 ? 1e-8 : 2e-8; },
    area() { calls.push(`area:${current}`); return 4; },
    subtract(country) { calls.push(`subtract:${country}`); return false; },
  });
  assert.deepEqual(result, { overlapAreaKm2: 4, donors: [{ index: 2, removed: true }] });
  assert.deepEqual(calls, ['union', 'bounds:-1:0', 'bounds:-1:1', 'intersection:-1:1',
    'bounds:-1:2', 'intersection:-1:2', 'area:2', 'subtract:2']);
});

test('shared GIS geometry plan preserves geometry operation errors', () => {
  const failure = new Error('overlap failed');
  assert.throws(() => sharedCalculationCore.planGisCountryGeometry(1, [0], true, {
    bounds() { return true; },
    intersection() { throw failure; },
  }), error => error === failure);
});

test('shared GIS merge commit threshold matches the existing boundary', () => {
  const canCommit = sharedCalculationCore.gisCountryMergeCanCommit;
  assert.equal(canCommit(0), true);
  assert.equal(canCommit(0.001), true);
  assert.equal(canCommit(0.0010001), false);
  assert.equal(canCommit(NaN), false);
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
