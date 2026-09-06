import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayerListModel, visibleLayerRows, setScopedItemVisibility } from '../../assets/js/modules/layer-list-model.js';
import { createObjectSelectionController } from '../../assets/js/modules/object-selection-controller.js';

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const fixture = (data, builtinSession = true) => createLayerListModel({
  items: group => data[group], groups: Object.keys(data), builtinSession,
  builtinCountryIds: new Set(['DEU', 'FRA']),
  itemRef: (group, id) => group === 'hydro' && id.startsWith('builtin') ? null
    : { key: `${group}:${id}`, id, domain: group },
  compare: (a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id),
});
const countries = [{ id: 'DEU', name: '독일 수정', geometry: { edited: true } }, { id: 'new', name: '새 나라' }];
const hydro = [{ id: 'builtin-river', name: 'HydroRIVERS', isBuiltin: true, hydroCategory: 'river' },
  { id: 'builtin-lake', name: 'Natural Earth', isBuiltin: true, hydroCategory: 'lake' },
  { id: 'user-river', name: '나의 강', hydroCategory: 'river' }];

test('political objects and all hydro occupy two folders; unrelated types remain direct', () => {
  const m = fixture({ countries, hydro, subunits: [{ id: 's', name: '홍콩' }], languages: [{ id: 'de', name: '독일어권' }], regions: [{ id: 'r', name: '알자스' }], labels: [{ id: 'p', name: '가 지명' }] });
  assert.deepEqual(m.bundles.map(b => b.name), ['정치체', '지형지물']);
  assert.deepEqual(m.bundles[0].items.map(i => i.id), ['DEU', 'new', 'r', 's']);
  assert.deepEqual(m.bundles[0].items.map(i => i.typeLabel), ['국가', '국가', '지방', '하위단위']);
  assert.equal(m.bundles[1].items.length, 3);
  assert.ok(m.bundles[1].items.some(i => i.id === 'user-river'));
  assert.deepEqual(m.objects.map(i => i.name), ['가 지명', '독일어권']);
  assert.deepEqual(m.objects.map(i => i.typeLabel), ['지명', '언어']);
});
test('external project countries share the political folder without changing their provenance', () => {
  const m = fixture({ countries }, false);
  assert.equal(m.bundles.length, 1);
  assert.equal(m.bundles[0].id, 'polities');
  assert.equal(m.bundles[0].items.length, 2);
  assert.equal(m.objects.length, 0);
});
test('empty bundles disappear and restored objects recreate them; hidden/error items remain', () => {
  assert.equal(fixture({ countries: [], hydro: [] }).bundles.length, 0);
  const m = fixture({ countries: [{ ...countries[0], visible: false }], hydro: hydro.map(i => ({ ...i, loadState: 'error' })) });
  assert.equal(m.bundles.length, 2);
  assert.equal(m.bundles[0].items.length, 1);
});
test('logical range order includes off-DOM expanded children but not collapsed children', () => {
  const m = fixture({ countries, hydro, regions: Array.from({ length: 1000 }, (_, i) => ({ id: String(i), name: `지역 ${i}` })) });
  const closed = visibleLayerRows(m, {}), open = visibleLayerRows(m, { polities: true });
  assert.equal(closed.some(i => i.id === 'DEU'), false);
  assert.equal(open.some(i => i.id === 'DEU'), true);
  assert.equal(open.filter(i => i.ref).length, 1002);
  assert.equal(open.filter(i => i.ref).at(-1).id, '999');
});
test('equal names sort by full ObjectKey, and search does not duplicate bundle members', () => {
  const m = fixture({ countries: [{ id: 'DEU', name: '동명' }], labels: [{ id: 'DEU', name: '동명' }] });
  assert.deepEqual(visibleLayerRows(m, {}, '동명').map(i => i.key), ['countries:DEU', 'labels:DEU']);
  assert.equal(visibleLayerRows(m, {}, '지명').length, 1);
});
test('bundle visibility preserves user objects, including old globally hidden projects and save/reopen', () => {
  const state = { layerVisibility: { countries: false }, itemVisibility: { countries: {} } };
  const run = visible => setScopedItemVisibility({ ...state, group: 'countries', allIds: ['DEU', 'new'], ids: ['DEU'], visible });
  run(true);
  assert.equal(state.layerVisibility.countries, true);
  assert.equal(state.itemVisibility.countries.new, false);
  assert.equal(state.itemVisibility.countries.DEU, undefined);
  run(false);
  const saved = JSON.parse(JSON.stringify(state));
  assert.deepEqual(saved.itemVisibility.countries, { new: false, DEU: false });
  delete state.itemVisibility.countries.new;
  run(true); run(false);
  assert.equal(state.itemVisibility.countries.new, undefined);
});
test('source geometry is never inspected or cloned to classify rows', () => {
  const source = { id: 'DEU', name: '독일' };
  Object.defineProperty(source, 'geometry', { get() { throw new Error('geometry read'); } });
  assert.equal(fixture({ countries: [source] }).bundles[0].items[0].id, 'DEU');
});
test('mixed-type range is delegated to the normal selection controller with a shared scope', () => {
  const controller = createObjectSelectionController();
  const refs = [{ domain: 'territorial', type: 'country', id: 'DEU' }, { domain: 'distribution', type: 'language', id: 'de' }, { domain: 'label', type: 'label', id: 'x' }];
  controller.replace(refs[0], { scope: 'layer-list' });
  controller.selectRange(refs[2], refs, { scope: 'layer-list' });
  assert.equal(controller.size(), 3);
});
