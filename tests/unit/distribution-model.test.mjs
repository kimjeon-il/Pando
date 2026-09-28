import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISTRIBUTION_MODES, DISTRIBUTION_SCHEMA_VERSION, createDistributionEntry, createDistributionLayer,
  distributionValueAlpha, distributionValueRange, normalizeDistributionEntries, normalizeDistributionLayers,
  validateDistributionModel,
} from '../../assets/js/modules/distribution-model.js';

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
