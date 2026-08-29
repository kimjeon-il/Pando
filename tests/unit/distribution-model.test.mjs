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

test('distribution entries allow several independent shares in one region', () => {
  const layers = [
    createDistributionLayer({ id: 'greek', type: 'language', name: '그리스어', color: '#3366aa' }),
    createDistributionLayer({ id: 'turkish', type: 'language', name: '튀르키예어', color: '#cc6644' }),
  ];
  const entries = normalizeDistributionEntries([
    createDistributionEntry({ id: 'e1', layerId: 'greek', mode: 'region', regionId: 'attica', share: 95 }),
    createDistributionEntry({ id: 'e2', layerId: 'turkish', mode: 'region', regionId: 'attica', share: 20 }),
  ], { layerExists: id => layers.some(layer => layer.id === id) });
  assert.deepEqual(entries.map(entry => entry.share), [95, 20]);
  assert.equal(validateDistributionModel(layers, entries, { territorialExists: id => id === 'attica' }).ok, true);
  assert.equal(dominantDistributionEntries(layers, entries)[0].layerId, 'greek');
});

test('region and free geometry distribution modes normalize independently', () => {
  const layer = createDistributionLayer({ id: 'orthodox', type: 'religion', name: '정교회' });
  const region = createDistributionEntry({ id: 'r', layerId: layer.id, mode: DISTRIBUTION_MODES.REGION, regionId: 'unit', share: 80 });
  const geometry = createDistributionEntry({ id: 'g', layerId: layer.id, mode: DISTRIBUTION_MODES.GEOMETRY, geometry: square, share: 45 });
  assert.equal(region.geometry, null);
  assert.deepEqual(geometry.geometry, square);
});

test('distribution normalization rejects legacy aliases and duplicate IDs', () => {
  assert.throws(() => normalizeDistributionLayers([{ id: 'legacy', distributionType: 'language' }]), /schemaVersion/);
  const layer = createDistributionLayer({ id: 'same', type: 'language' });
  assert.throws(() => normalizeDistributionLayers([layer, layer]), /중복/);
  assert.throws(() => normalizeDistributionEntries([{
    id: 'entry', schemaVersion: DISTRIBUTION_SCHEMA_VERSION, layer_id: 'same', mode: 'geometry', geometry: square,
  }]), /레이어 ID가 비어/);
});
