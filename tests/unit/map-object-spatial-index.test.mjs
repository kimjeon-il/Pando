import assert from 'node:assert/strict';
import test from 'node:test';

import { createMapObjectSpatialIndex } from '../../assets/js/modules/map-object-spatial-index.js';

test('queries only nearby map objects and updates entries', () => {
  const index = createMapObjectSpatialIndex({ cellSize: 5 });
  index.upsert({ key: 'territorial:a', domain: 'territorial', type: 'admin', id: 'a', bounds: [10, 10, 12, 12] });
  index.upsert({ key: 'drawing:b', domain: 'drawing', type: 'polygon', id: 'b', bounds: [80, 30, 82, 32] });
  assert.deepEqual(index.query([9, 9, 13, 13]).map(item => item.key), ['territorial:a']);
  index.upsert({ key: 'territorial:a', domain: 'territorial', type: 'admin', id: 'a', bounds: [81, 30, 83, 33], geometryRevision: 2 });
  assert.deepEqual(index.query([9, 9, 13, 13]), []);
  assert.deepEqual(new Set(index.query([80, 29, 84, 34]).map(item => item.key)), new Set(['territorial:a', 'drawing:b']));
});

test('supports date-line bounds, domain filters, and large entries', () => {
  const index = createMapObjectSpatialIndex({ cellSize: 5, maxCellsPerEntry: 4 });
  index.upsert({ key: 'country:date-line', domain: 'country', type: 'country', id: 'date-line', bounds: [170, -10, -170, 10] });
  index.upsert({ key: 'country:large', domain: 'country', type: 'country', id: 'large', bounds: [-50, -30, 60, 40] });
  index.upsert({ key: 'label:x', domain: 'label', type: 'city', id: 'x', bounds: [175, 0, 175, 0] });
  assert.deepEqual(new Set(index.query([174, -2, 179, 2], { domains: ['country'] }).map(item => item.id)), new Set(['date-line', 'large']));
  assert.deepEqual(new Set(index.query([-179, -2, -174, 2], { domains: ['country'] }).map(item => item.id)), new Set(['date-line', 'large']));
  assert.equal(index.stats().largeEntryCount, 2);
  assert.equal(index.clearDomain('label'), 1);
  assert.equal(index.stats().entryCount, 2);
});
