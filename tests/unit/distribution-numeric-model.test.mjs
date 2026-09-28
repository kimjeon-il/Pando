import test from 'node:test';
import assert from 'node:assert/strict';
import { createDistributionEntry, createDistributionLayer, distributionValueRange, distributionValueAlpha, normalizeDistributionLayers } from '../../assets/js/modules/distribution-model.js';

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
