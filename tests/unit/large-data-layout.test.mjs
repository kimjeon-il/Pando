import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutLabels } from '../../assets/js/modules/label-layout.js';
import { layoutLabelsLegacy } from '../../tools/benchmark-helpers/legacy-label-layout.mjs';

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

test('screen-grid label layout is sequence-equivalent to the legacy policy', () => {
  for (let seed = 1; seed <= 120; seed += 1) {
    const random = seededRandom(seed);
    const candidates = Array.from({ length: 80 }, (_, index) => ({
      key: `label-${String(index).padStart(3, '0')}`,
      point: [random() * 800, random() * 500],
      width: 20 + random() * 140,
      height: 12 + random() * 24,
      priority: Math.floor(random() * 6),
      selected: random() < 0.02,
      pinned: random() < 0.08,
      collisionGroup: random() < 0.35 ? 'country' : 'place',
      minZoom: random() < 0.15 ? 2 : 0,
      maxZoom: random() < 0.1 ? 1 : 10,
    }));
    const options = { zoom: 1.5, padding: 3 };
    assert.deepEqual(
      layoutLabels(candidates, options).map(item => item.key),
      layoutLabelsLegacy(candidates, options).map(item => item.key),
      `seed ${seed}`,
    );
  }
});

test('screen grid avoids quadratic collision scans for separated labels', () => {
  const candidates = Array.from({ length: 2_000 }, (_, index) => ({
    key: `label-${index}`,
    point: [(index % 100) * 120, Math.floor(index / 100) * 60],
    width: 40,
    height: 16,
    priority: 1,
    collisionGroup: 'place',
  }));
  const optimizedMetrics = {};
  const legacyMetrics = {};
  const optimized = layoutLabels(candidates, { metrics: optimizedMetrics });
  const legacy = layoutLabelsLegacy(candidates, { metrics: legacyMetrics });
  assert.deepEqual(optimized.map(item => item.key), legacy.map(item => item.key));
  assert.ok(optimizedMetrics.collisionCheckCount < legacyMetrics.collisionCheckCount / 100);
  assert.equal(optimizedMetrics.placedCount, 2_000);
});
