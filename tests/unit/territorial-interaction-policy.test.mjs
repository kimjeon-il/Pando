import test from 'node:test';
import assert from 'node:assert/strict';
import { subunitSelectionPolicy, territorialDeletionAllowed, removeTerritorialUnits, boundaryTouchesGeometry } from '../../assets/js/modules/territorial-interaction-policy.js';

const unit = (id, parentId = 'KR', locked = false) => ({ id, properties: { unitType: 'subunit', sovereignId: 'KR', parentId, locked } });
test('multiple subunits require one parent, unlocked objects and a connected selection', () => {
  const units = [unit('a'), unit('b'), unit('c')];
  const adjacent = (a, b) => Math.abs(a.id.charCodeAt(0) - b.id.charCodeAt(0)) === 1;
  assert.equal(subunitSelectionPolicy(units, { adjacent }).valid, true);
  assert.equal(subunitSelectionPolicy([units[0], units[2]], { adjacent }).valid, false);
  units[1].properties.parentId = 'other';
  assert.equal(subunitSelectionPolicy(units, { adjacent }).valid, false);
  units[1].properties.parentId = 'KR'; units[1].properties.locked = true;
  assert.equal(subunitSelectionPolicy(units, { adjacent }).valid, false);
});
test('single and batch deletion never expands into descendants and rechecks changed locks', () => {
  const a = unit('a'), b = unit('b');
  const state = { territorialUnits: [a, b], territorialRelations: [], distributionEntries: [{ mode: 'territorial', territorialUnitId: 'a' }], itemVisibility: { subunits: { a: false } }, labelSettings: { 'subunit:a': {} } };
  state.territorialUnits.push(unit('child', 'a'));
  assert.equal(territorialDeletionAllowed([a, b], state.territorialUnits), false);
  const before = structuredClone(state);
  assert.throws(() => removeTerritorialUnits(state, ['a', 'b'], 'territorial'));
  assert.deepEqual(state, before);
  state.territorialUnits.pop(); b.properties.locked = true;
  assert.throws(() => removeTerritorialUnits(state, ['a', 'b'], 'territorial'));
  b.properties.locked = false;
  removeTerritorialUnits(state, ['a'], 'territorial');
  assert.deepEqual(state.territorialUnits, [b]);
  assert.deepEqual(state.distributionEntries, []);
  assert.deepEqual(state.labelSettings, {});
});
test('locked boundary checks include interior points of differently segmented edges', () => {
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] };
  assert.equal(boundaryTouchesGeometry(geometry, [1, 0]), true);
  assert.equal(boundaryTouchesGeometry(geometry, [3, 0]), false);
});
