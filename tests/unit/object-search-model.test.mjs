import test from 'node:test';
import assert from 'node:assert/strict';
import { createObjectSearchModel, visibleObjectSearchRows, setScopedItemVisibility } from '../../assets/js/modules/object-search-model.js';
import { createNodeSelection } from '../helpers/core-selection.mjs';

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const fixture = (data, builtinSession = true) => createObjectSearchModel({
  items: group => data[group], groups: Object.keys(data), builtinSession,
  builtinCountryIds: new Set(['DEU', 'FRA']),
  itemRef: (group, id) => group === 'hydro' && id.startsWith('builtin') ? null
    : { key: `${group}:${id}`, id, domain: group },
  compare: (a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id),
});
const objects = [{ id: 'DEU', name: '독일 수정', geometry: { edited: true } }, { id: 'new', name: '새 나라' }];
test('objects default closed, expand along parents, and remain searchable with orphan and region rows', () => {
  const m = fixture({ objects: [...objects,
    { id: 's', name: '하위', parentId: 'DEU' },
    { id: 'nested', name: '중첩', parentId: 's' },
    { id: 'orphan', name: '독립', parentId: 'missing' },
    {id:'r',name:'지방',parentId:'DEU'},
  ] });
  const ids = expanded => visibleObjectSearchRows(m, { polities: true }, '', expanded).map(row => row.id);
  assert.ok(!ids().includes('s'));
  assert.ok(ids().includes('orphan'));
  assert.ok(!ids().includes('r'));
  assert.ok(ids(new Set(['objects:DEU'])).includes('r'));
  assert.ok(ids(new Set(['objects:DEU'])).includes('s'));
  assert.ok(!ids(new Set(['objects:DEU'])).includes('nested'));
  const open = visibleObjectSearchRows(m, { polities: true }, '', new Set(['objects:DEU', 'objects:s']));
  assert.equal(open.find(row => row.id === 'nested').depth, 2);
  assert.equal(visibleObjectSearchRows(m, {}, '중첩')[0].id, 'nested');
});

test('cyclic object relationships remain reachable without recursive loops', () => {
  const m = fixture({ objects: [{ id: 'a', name: 'a', parentId: 'b' }, { id: 'b', name: 'b', parentId: 'a' }] });
  const rows = visibleObjectSearchRows(m, { polities: true }, '', new Set(['objects:a', 'objects:b']));
  assert.equal(rows.filter(row => row.ref).length, 2);
});
const hydro = [{ id: 'builtin-river', name: 'HydroRIVERS', isBuiltin: true, hydroCategory: 'river' },
  { id: 'builtin-lake', name: 'Natural Earth', isBuiltin: true, hydroCategory: 'lake' },
  { id: 'user-river', name: '나의 강', hydroCategory: 'river' }];

test('political objects and all hydro occupy two folders; unrelated types remain direct', () => {
  const m = fixture({ objects:[...objects,{id:'s',name:'홍콩'},{id:'r',name:'알자스'}],hydro,distributions:[{id:'de',name:'독일어권'}],labels: [{ id: 'p', name: '가 지명' }] });
  assert.deepEqual(m.bundles.map(b => b.name), ['정치체', '지형지물']);
  assert.deepEqual(m.bundles[0].items.map(i => i.id), ['DEU', 'new', 'r', 's']);
  assert.deepEqual(m.bundles[0].items.map(i => i.typeLabel), ['객체', '객체', '객체', '객체']);
  assert.equal(m.bundles[1].items.length, 3);
  assert.ok(m.bundles[1].items.some(i => i.id === 'user-river'));
  assert.deepEqual(m.objects.map(i => i.name), ['가 지명', '독일어권']);
  assert.deepEqual(m.objects.map(i => i.typeLabel), ['지명', '분포']);
});
test('external project objects share the political folder without changing their provenance', () => {
  const m = fixture({ objects }, false);
  assert.equal(m.bundles.length, 1);
  assert.equal(m.bundles[0].id, 'polities');
  assert.equal(m.bundles[0].items.length, 2);
  assert.equal(m.objects.length, 0);
});
test('empty bundles disappear and restored objects recreate them; hidden/error items remain', () => {
  assert.equal(fixture({ objects: [], hydro: [] }).bundles.length, 0);
  const m = fixture({ objects: [{ ...objects[0], visible: false }], hydro: hydro.map(i => ({ ...i, loadState: 'error' })) });
  assert.equal(m.bundles.length, 2);
  assert.equal(m.bundles[0].items.length, 1);
});
test('logical range order includes off-DOM expanded children but not collapsed children', () => {
  const m = fixture({ objects:[...objects,...Array.from({ length: 1000 }, (_, i) => ({ id: String(i), name: `지역 ${i}` }))],hydro });
  const closed = visibleObjectSearchRows(m, {}), open = visibleObjectSearchRows(m, { polities: true });
  assert.equal(closed.some(i => i.id === 'DEU'), false);
  assert.equal(open.some(i => i.id === 'DEU'), true);
  assert.equal(open.filter(i => i.ref).length, 1002);
  assert.equal(open.filter(i => i.ref).at(-1).id, '999');
});
test('equal names sort by full ObjectKey, and search does not duplicate bundle members', () => {
  const m = fixture({ objects: [{ id: 'DEU', name: '동명' }], labels: [{ id: 'DEU', name: '동명' }] });
  assert.deepEqual(visibleObjectSearchRows(m, {}, '동명').map(i => i.key), ['labels:DEU', 'objects:DEU']);
  assert.equal(visibleObjectSearchRows(m, {}, '지명').length, 1);
});
test('bundle visibility preserves user objects, including old globally hidden projects and save/reopen', () => {
  const state = { layerVisibility: { objects: false }, itemVisibility: { objects: {} } };
  const run = visible => setScopedItemVisibility({ ...state, group: 'objects', allIds: ['DEU', 'new'], ids: ['DEU'], visible });
  run(true);
  assert.equal(state.layerVisibility.objects, true);
  assert.equal(state.itemVisibility.objects.new, false);
  assert.equal(state.itemVisibility.objects.DEU, undefined);
  run(false);
  const saved = JSON.parse(JSON.stringify(state));
  assert.deepEqual(saved.itemVisibility.objects, { new: false, DEU: false });
  delete state.itemVisibility.objects.new;
  run(true); run(false);
  assert.equal(state.itemVisibility.objects.new, undefined);
});
test('source geometry is never inspected or cloned to classify rows', () => {
  const source = { id: 'DEU', name: '독일' };
  Object.defineProperty(source, 'geometry', { get() { throw new Error('geometry read'); } });
  assert.equal(fixture({ objects: [source] }).bundles[0].items[0].id, 'DEU');
});
test('mixed-type range is delegated to the actual Core selection owner with a shared scope', async t => {
  const owner = await createNodeSelection();t.after(() => owner.dispose());
  const controller = owner.domain;
  const refs = [{ domain: 'territorial', type: 'entity', id: 'DEU' }, { domain: 'distribution', type: 'distribution', id: 'de' }, { domain: 'label', type: 'label', id: 'x' }];
  await controller.replace(refs[0], { scope: 'layer-list' });
  await controller.selectRange(refs[2], refs, { scope: 'layer-list' });
  assert.equal(controller.size(), 3);
  assert.deepEqual(controller.snapshot().selection.items.map(ref => ref.id), ['DEU', 'de', 'x']);
  assert.equal(controller.primary().id, 'x');
});
