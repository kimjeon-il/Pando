import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISTRIBUTION_MODES,
  createDistributionEntry,
  createDistributionLayer,
  dominantDistributionEntries,
  migrateThematicDrawings,
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

test('thematic drawings migrate to one layer plus 100 percent geometry entries', () => {
  const drawing = id => ({ type: 'Feature', id, properties: { category: 'ethnicity', name: '그리스인', editorColor: '#123456' }, geometry: square });
  const migrated = migrateThematicDrawings([drawing('a'), drawing('b'), { type: 'Feature', id: 'river', properties: { category: 'river' }, geometry: { type: 'LineString', coordinates: [] } }]);
  assert.equal(migrated.layers.length, 1);
  assert.equal(migrated.entries.length, 2);
  assert.ok(migrated.entries.every(entry => entry.share === 100 && entry.mode === 'geometry'));
  assert.deepEqual(migrated.remainingDrawings.map(item => item.id), ['river']);
  assert.equal(normalizeDistributionLayers(migrated.layers).length, 1);
});
