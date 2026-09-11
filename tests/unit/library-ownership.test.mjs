import test from 'node:test';
import assert from 'node:assert/strict';
import { missingLibraryOwnership, prepareLibraryOwnership, subunitParentChoices } from '../../assets/js/modules/library-ownership.js';

const country = id => ({ type: 'Feature', id, properties: { name: id }, geometry: {} });
const unit = (id, parentId = 'A', sovereignId = 'A') => ({ type: 'Feature', id, geometry: {}, properties: { name: id, unitType: 'subunit', parentId, sovereignId } });
const root = { libraryId: 'root', type: 'subunit', name: 'Root', parentLibraryId: 'old-parent', sovereignLibraryId: 'old-country', geometry: {}, geometryVersionId: 'v1', validFrom: '1900' };
const child = { ...root, libraryId: 'child', name: 'Child', parentLibraryId: 'root' };
function prepare(descriptors, choices = {}, units = [], refs = {}) {
  let counter = 0;
  return prepareLibraryOwnership({ descriptors, choices, countries: [country('A'), country('B')], units,
    resolve: id => refs[id] || '', allocateId: () => `new-${++counter}`, contains: () => true });
}

test('missing ownership never matches names or assigns an arbitrary country; intermediate parent defaults sovereign', () => {
  assert.deepEqual(missingLibraryOwnership([root], () => '', [country('A')], []), [{ libraryId: 'root', name: 'Root', countryId: '' }]);
  const refs = { 'old-country': 'A' };
  assert.equal(missingLibraryOwnership([root], id => refs[id] || '', [country('A')], [])[0].countryId, 'A');
  refs['old-parent'] = 'P';
  assert.equal(missingLibraryOwnership([root], id => refs[id] || '', [country('A')], [unit('P')]).length, 0);
  assert.throws(() => prepare([root]), /소속/);
  assert.throws(() => prepare([root], { root: { mode: 'subunit', countryId: '' } }), /국가를 선택/);
});

test('parent choices use actual country name and depth, exclude cycles and other countries', () => {
  const units = [unit('Z'), unit('X', 'Z'), unit('C', 'B', 'B')];
  assert.deepEqual(subunitParentChoices('A', [country('A')], units).map(item => item.value), ['A', 'Z', 'X']);
  assert.equal(subunitParentChoices('A', [country('A')], units)[0].label, 'A');
  assert.deepEqual(subunitParentChoices('A', [country('A')], units, { exclude: ['Z'] }).map(item => item.value), ['A']);
});

test('explicit country and nested parent apply once; children inherit the chosen sovereign', () => {
  const before = JSON.stringify([root, child]);
  const prepared = prepare([child, root], { root: { mode: 'subunit', countryId: 'B', parentId: 'P' } }, [unit('P', 'B', 'B')]);
  const parent = prepared.find(item => item.libraryId === 'root');
  const nested = prepared.find(item => item.libraryId === 'child');
  assert.equal(parent.parentId, 'P');
  assert.equal(parent.sovereignId, 'B');
  assert.equal(nested.parentId, parent.id);
  assert.equal(nested.sovereignId, 'B');
  assert.equal(JSON.stringify([root, child]), before);
  assert.throws(() => prepare([root], { root: { mode: 'subunit', countryId: 'A', parentId: 'P' } }, [unit('P', 'B', 'B')]), /상위 소속/);
});

test('promotion clears active parents, preserves source refs/version/period, and reparents children', () => {
  const result = prepare([root, child], { root: { mode: 'country', name: 'New country' } });
  assert.equal(result[0].type, 'country');
  assert.equal(result[0].parentId, '');
  assert.equal(result[0].sovereignId, '');
  assert.equal(result[0].name, 'New country');
  assert.equal(result[0].parentLibraryId, 'old-parent');
  assert.equal(result[0].geometryVersionId, 'v1');
  assert.equal(result[0].validFrom, '1900');
  assert.equal(result[1].parentId, 'root');
  assert.equal(result[1].sovereignId, 'root');
});

test('existing parent reuse and automatic linkage; missing ancestor only prompts once', () => {
  const refs = { 'old-parent': 'P', 'old-country': 'A' };
  assert.equal(prepare([root], {}, [unit('P')], refs)[0].parentId, 'P');
  assert.equal(missingLibraryOwnership([root, child], () => '', [country('A')], []).length, 1);
  assert.equal(prepare([root], {}, [unit('P')], { ...refs, root: 'P' }).length, 0);
});

test('invalid containing subunit and library cycles are rejected before application', () => {
  assert.throws(() => prepareLibraryOwnership({ descriptors: [root], choices: { root: { mode: 'subunit', countryId: 'A', parentId: 'P' } },
    countries: [country('A')], units: [unit('P')], resolve: () => '', allocateId: () => 'new', contains: () => false }), /포함되지/);
  assert.throws(() => prepare([{ ...root, parentLibraryId: 'child' }, child]), /순환/);
});
