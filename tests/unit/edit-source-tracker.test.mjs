import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditSourceTracker } from '../../assets/js/modules/edit-source-tracker.js';

test('source deltas separate metadata, coordinates, object namespaces and removals', () => {
  const tracker = createEditSourceTracker();
  const feature = { id: 'RUS', properties: { name: 'Russia' }, geometry: { type: 'Polygon', coordinates: [] } };
  const rows = [{ kind: 'country', feature }];
  const first = tracker.update(rows);
  assert.equal(first.patches.length, 1);
  assert.equal(tracker.update(rows).patches.length, 0);
  feature.properties.name = 'Renamed';
  const renamed = tracker.update(rows);
  assert.equal(renamed.sourceRevision, first.sourceRevision);
  assert.equal(Object.hasOwn(renamed.patches[0], 'geometry'), false);
  feature.properties.locked = true;
  assert.ok(tracker.update(rows).sourceRevision > first.sourceRevision);
  rows.push({ kind: 'generic', feature: { ...feature } });
  assert.equal(tracker.update(rows).patches[0].key, 'generic:RUS');
  rows[0].geometryRevision = 1;
  assert.ok(Object.hasOwn(tracker.update(rows).patches[0], 'geometry'));
  assert.deepEqual(tracker.update([]).removedKeys, ['country:RUS', 'generic:RUS']);
});

test('reset transfers current sources even when their identities survive restore', () => {
  const tracker = createEditSourceTracker();
  const rows = [{ kind: 'territorial', feature: { id: 'child', properties: {}, geometry: null } }];
  const before = tracker.update(rows);
  tracker.reset();
  const after = tracker.update(rows);
  assert.equal(after.patches.length, 1);
  assert.ok(after.sourceRevision > before.sourceRevision);
});
