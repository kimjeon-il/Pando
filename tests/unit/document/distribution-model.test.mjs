import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep3 from "../../../src/document/distribution-model.js";

// Original feature contract: distribution-service.test.mjs


// Original feature contract: distribution-model.test.mjs
contractSuite("distribution-model", () => {
const test=__dep1.default;
const assert=__dep0.default;
const { DISTRIBUTION_MODES, DISTRIBUTION_SCHEMA_VERSION, createDistributionEntry, createDistributionLayer, distributionValueAlpha, distributionValueRange, normalizeDistributionEntries, normalizeDistributionLayers, validateDistributionModel }=__dep3;

const square = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };

test('independent distributions preserve signed numbers without comparing layers', () => {
  const layers = [
    createDistributionLayer({ id: 'population', name: '인구', unit: '명', color: '#3366aa' }),
    createDistributionLayer({ id: 'temperature', name: '기온', unit: '°C', color: '#cc6644' }),
  ];
  const entries = normalizeDistributionEntries([
    createDistributionEntry({ id: 'e1', layerId: 'population', mode: 'territorial', territorialUnitId: 'attica', value: 95.5 }),
    createDistributionEntry({ id: 'e2', layerId: 'temperature', mode: 'territorial', territorialUnitId: 'attica', value: -20 }),
  ], { layerExists: id => layers.some(layer => layer.id === id) });
  assert.deepEqual(entries.map(entry => entry.value), [95.5, -20]);
  assert.equal(validateDistributionModel(layers, entries, { territorialExists: id => id === 'attica' }).ok, true);
  assert.deepEqual(distributionValueRange(layers[0], entries.filter(entry => entry.layerId === layers[0].id)), { min: 95.5, max: 95.5 });
});

test('territorial and free geometry modes normalize independently', () => {
  const layer = createDistributionLayer({ id: 'temperature', name: '기온' });
  const territorial = createDistributionEntry({ id: 'r', layerId: layer.id, mode: DISTRIBUTION_MODES.TERRITORIAL, territorialUnitId: 'unit', value: 0 });
  const geometry = createDistributionEntry({ id: 'g', layerId: layer.id, mode: DISTRIBUTION_MODES.GEOMETRY, geometry: square, value: -4.25 });
  assert.equal(territorial.geometry, null);
  assert.deepEqual(geometry.geometry, square);
});

test('canonical fields and unique IDs are required', () => {
  assert.throws(() => normalizeDistributionLayers([{ id: 'invalid', schemaVersion: DISTRIBUTION_SCHEMA_VERSION, type: 'language' }]), /지원하지 않는 필드/);
  const layer = createDistributionLayer({ id: 'same' });
  assert.throws(() => normalizeDistributionLayers([layer, layer]), /중복/);
  assert.throws(() => normalizeDistributionEntries([{
    id: 'entry', schemaVersion: DISTRIBUTION_SCHEMA_VERSION, layerId: 'same', mode: 'geometry', geometry: square, value: 1, unknownField: true,
  }]), /지원하지 않는 필드/);
});

test('missing and non-finite values fail while signed values and clamped display survive', () => {
  const base = { id: 'entry', layerId: 'layer', mode: DISTRIBUTION_MODES.GEOMETRY, geometry: square };
  for (const value of [null, '', Number.NaN, Infinity, -Infinity]) {
    assert.throws(() => createDistributionEntry({ ...base, value }), /유한한 숫자/);
  }
  assert.equal(createDistributionEntry({ ...base, value: 0 }).value, 0);
  assert.equal(createDistributionEntry({ ...base, value: -1.5 }).value, -1.5);
  assert.equal(distributionValueAlpha(-10, { min: 0, max: 10 }), 0.12);
  assert.equal(distributionValueAlpha(20, { min: 0, max: 10 }), 0.7);
});
});

// Original feature contract: distribution-numeric-model.test.mjs
contractSuite("distribution-numeric-model", () => {
const test=__dep1.default;
const assert=__dep0.default;
const { createDistributionEntry, createDistributionLayer, distributionValueRange, distributionValueAlpha, normalizeDistributionLayers }=__dep3;

test('generic distribution stores a unit, a scale, and signed values without a type', () => {
  const parent = createDistributionLayer({ id: 'population', name: '인구밀도', unit: '명/km²' });
  const child = createDistributionLayer({ id: 'temperature', name: '기온', unit: '°C', parentId: parent.id });
  assert.equal('type' in parent, false);
  assert.equal(parent.valueScale.mode, 'auto');
  assert.equal(normalizeDistributionLayers([parent, child]).length, 2);
  const entry = createDistributionEntry({ id: 'cold', layerId: child.id, mode: 'territorial', territorialUnitId: 'region', value: -5.5 });
  assert.equal(entry.value, -5.5);
  assert.equal('share' in entry, false);
});

test('missing or invalid numbers and unordered manual ranges fail', () => {
  const base = { id: 'entry', layerId: 'layer', mode: 'territorial', territorialUnitId: 'region' };
  for (const value of [undefined, null, '', '   ', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createDistributionEntry({ ...base, value }), /유한한 숫자/);
  }
  assert.equal(createDistributionEntry({ ...base, value: 0 }).value, 0);
  assert.throws(() => createDistributionLayer({ id: 'bad', valueScale: { mode: 'manual', min: 5, max: 5 } }), /범위/);
});

test('automatic range uses all values and display alpha clamps without changing data', () => {
  const layer = createDistributionLayer({ id: 'layer' });
  const range = distributionValueRange(layer, [{ value: -10 }, { value: 0 }, { value: 20 }]);
  assert.deepEqual(range, { min: -10, max: 20 });
  assert.equal(distributionValueAlpha(-10, range), 0.12);
  assert.equal(distributionValueAlpha(20, range), 0.7);
  assert.equal(distributionValueAlpha(100, { min: 0, max: 10 }), 0.7);
  assert.equal(distributionValueAlpha(5, { min: 5, max: 5 }), 0.7);
  assert.equal(distributionValueRange(layer, []), null);
});
});
