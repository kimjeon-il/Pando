import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISTRIBUTION_MODES,
  DISTRIBUTION_SCHEMA_VERSION,
  createDistributionEntry,
  createDistributionLayer,
  dominantDistributionEntries,
  normalizeDistributionEntries,
  normalizeDistributionLayers,
  validateDistributionModel,
} from '../../assets/js/modules/distribution-model.js';

const square = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };

test('distribution entries allow several independent shares in one territorial unit', () => {
  const layers = [
    createDistributionLayer({ id: 'greek', type: 'language', name: '그리스어', color: '#3366aa' }),
    createDistributionLayer({ id: 'turkish', type: 'language', name: '튀르키예어', color: '#cc6644' }),
  ];
  const entries = normalizeDistributionEntries([
    createDistributionEntry({ id: 'e1', layerId: 'greek', mode: 'territorial', territorialUnitId: 'attica', share: 95 }),
    createDistributionEntry({ id: 'e2', layerId: 'turkish', mode: 'territorial', territorialUnitId: 'attica', share: 20 }),
  ], { layerExists: id => layers.some(layer => layer.id === id) });
  assert.deepEqual(entries.map(entry => entry.share), [95, 20]);
  assert.equal(validateDistributionModel(layers, entries, { territorialExists: id => id === 'attica' }).ok, true);
  assert.equal(dominantDistributionEntries(layers, entries)[0].layerId, 'greek');
});

test('territorial and free geometry distribution modes normalize independently', () => {
  const layer = createDistributionLayer({ id: 'orthodox', type: 'religion', name: '정교회' });
  const territorial = createDistributionEntry({ id: 'r', layerId: layer.id, mode: DISTRIBUTION_MODES.TERRITORIAL, territorialUnitId: 'unit', share: 80 });
  const geometry = createDistributionEntry({ id: 'g', layerId: layer.id, mode: DISTRIBUTION_MODES.GEOMETRY, geometry: square, share: 45 });
  assert.equal(territorial.geometry, null);
  assert.deepEqual(geometry.geometry, square);
});

test('distribution normalization requires canonical fields and unique IDs', () => {
  assert.throws(() => normalizeDistributionLayers([{ id: 'invalid', schemaVersion: DISTRIBUTION_SCHEMA_VERSION, type: 'language', unknownField: true }]), /지원하지 않는 필드/);
  const layer = createDistributionLayer({ id: 'same', type: 'language' });
  assert.throws(() => normalizeDistributionLayers([layer, layer]), /중복/);
  assert.throws(() => normalizeDistributionEntries([{
    id: 'entry', schemaVersion: DISTRIBUTION_SCHEMA_VERSION, layerId: 'same', mode: 'geometry', geometry: square, unknownField: true,
  }]), /지원하지 않는 필드/);
});

test('invalid distribution shares fail instead of being clamped or defaulted', () => {
  const base = { id: 'entry', layerId: 'layer', mode: DISTRIBUTION_MODES.GEOMETRY, geometry: square };
  assert.throws(() => createDistributionEntry({ ...base, share: Number.NaN }), /유한한 숫자/);
  assert.throws(() => createDistributionEntry({ ...base, share: -0.1 }), /0~100/);
  assert.throws(() => createDistributionEntry({ ...base, share: 100.1 }), /0~100/);
  assert.equal(createDistributionEntry({ ...base, share: 0 }).share, 0);
});
