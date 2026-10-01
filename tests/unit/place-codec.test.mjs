import assert from 'node:assert/strict';
import test from 'node:test';
import { encodePlaceTile, decodePlaceTile } from '../../assets/js/modules/place-codec.js';
import { normalizePlace, PLACE_LIMITS } from '../../assets/js/modules/place-contract.js';
const raw = { source: 'synthetic', sourceId: '서울:1', name: '서울 🗺️', kind: 'capital', coordinates: [127.12345, 37.56789], countryCode: 'KR', population: 12345678, priority: 90, minZoom: 1.25, featureCode: 'PPLC' };

test('place binary preserves canonical identity, Unicode and metadata', () => {
  const record = normalizePlace(raw);
  assert.deepEqual(decodePlaceTile(encodePlaceTile([raw])), [record]);
  assert.ok(Object.isFrozen(record) && Object.isFrozen(record.coordinates));
});
test('place contract rejects invalid coordinates, identity, ranking and oversized text', () => {
  for (const patch of [{ source: 'Invalid/Source' }, { sourceId: '' }, { name: 'x'.repeat(257) }, { coordinates: [181, 0] }, { coordinates: [0, 91] }, { coordinates: [NaN, 0] }, { population: -1 }, { priority: 1e40 }, { minZoom: 1e40 }, { kind: 'invalid' }]) assert.throws(() => normalizePlace({ ...raw, ...patch }));
});
test('codec rejects truncation, wrong version, corrupt offsets and excess records', () => {
  const original = encodePlaceTile([raw]);
  assert.throws(() => decodePlaceTile(original.slice(0, -1)));
  for (const [offset, value] of [[4, 2], [8, 513], [16, 1], [68, 999999]]) {
    const bytes = original.slice(0); const view = new DataView(bytes);
    if (offset === 4) view.setUint16(offset, value, true); else view.setUint32(offset, value, true);
    assert.throws(() => decodePlaceTile(bytes));
  }
  assert.throws(() => encodePlaceTile(Array(PLACE_LIMITS.tileRecords + 1).fill(raw)));
});
