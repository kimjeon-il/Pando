import test from 'node:test';
import assert from 'node:assert/strict';
import {
  missingLibraryOwnership,
  prepareLibraryOwnership,
  shouldShowTerritorialParentChoice,
  territorialParentChoices,
} from '../../assets/js/modules/library-ownership.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] };
const country = id => createTerritorialFeature({ id, entityKind: 'general', name: id, geometry });
const unit = (id, parentId = 'A') => createTerritorialFeature({ id, entityKind: 'general', name: id, parentId, geometry });
const root = { libraryId: 'root', entityKind: 'general', name: 'Root', parentLibraryId: 'old-parent', geometry: {}, geometryVersionId: 'v1', validFrom: '1900' };
const child = { ...root, libraryId: 'child', name: 'Child', parentLibraryId: 'root' };
function prepare(descriptors, choices = {}, units = [], refs = {}) {
  let counter = 0;
  return prepareLibraryOwnership({ descriptors, choices, countries: [country('A'), country('B')], units,
    resolve: id => refs[id] || '', allocateId: () => `new-${++counter}`, contains: () => true });
}

test('missing ownership never matches names or assigns an arbitrary country; intermediate parent defaults sovereign', () => {
  assert.deepEqual(missingLibraryOwnership([root], () => '', [country('A')], []), [{ libraryId: 'root', name: 'Root', countryId: '' }]);
  const refs = { 'old-country': 'A' };
  assert.equal(missingLibraryOwnership([root], id => refs[id] || '', [country('A')], [])[0].countryId, '');
  refs['old-parent'] = 'P';
  assert.equal(missingLibraryOwnership([root], id => refs[id] || '', [country('A')], [unit('P')]).length, 0);
  assert.throws(() => prepare([root]), /소속/);
  assert.throws(() => prepare([root], { root: { mode: 'child', countryId: '' } }), /국가를 선택/);
});

test('parent choices use actual country name and depth, exclude cycles and other countries', () => {
  const countries = [country('A'), country('B')];
  const units = [unit('Z'), unit('X', 'Z'), unit('C', 'B')];
  assert.deepEqual(territorialParentChoices('A', countries, units).map(item => item.value), ['A', 'Z', 'X']);
  assert.equal(territorialParentChoices('A', countries, units)[0].label, 'A');
  assert.deepEqual(territorialParentChoices('A', countries, units, { exclude: ['Z'] }).map(item => item.value), ['A']);
});

test('parent choices accept the common territorial entity repository read surface', () => {
  const countries = [country('A'), country('B')];
  const units = [unit('Z'), unit('X', 'Z'), unit('C', 'B')];
  const entities = [...countries, ...units];
  const repository = createTerritorialEntityRepository({ getEntities: () => entities });

  assert.deepEqual(territorialParentChoices('A', repository).map(item => item.value), ['A', 'Z', 'X']);
  assert.deepEqual(territorialParentChoices('A', repository, { exclude: ['Z'] }).map(item => item.value), ['A']);
});

test('parent selector is hidden only when the sovereign is its sole valid choice', () => {
  assert.equal(shouldShowTerritorialParentChoice({
    rootId: 'A', parentId: 'A', options: [{ value: 'A', label: 'Country A' }],
  }), false);
  assert.equal(shouldShowTerritorialParentChoice({
    rootId: 'A', parentId: 'A', options: [{ value: '', label: 'Choose' }, { value: 'A', label: 'Country A' }],
  }), false);
  assert.equal(shouldShowTerritorialParentChoice({
    rootId: 'A', parentId: 'A', options: [{ value: 'A' }, { value: 'P' }],
  }), true);
  assert.equal(shouldShowTerritorialParentChoice({
    rootId: 'A', parentId: 'P', options: [{ value: 'A' }, { value: 'P' }],
  }), true);
  assert.equal(shouldShowTerritorialParentChoice({
    rootId: 'A', parentId: 'A', options: [] },
  ), true);
  assert.equal(shouldShowTerritorialParentChoice({
    rootId: 'A', parentId: 'A', options: [{ value: 'B', label: 'Country A' }],
  }), true);
});

test('explicit country and nested parent apply once; children inherit the chosen sovereign', () => {
  const before = JSON.stringify([root, child]);
  const prepared = prepare([child, root], { root: { mode: 'child', countryId: 'B', parentId: 'P' } }, [unit('P', 'B')]);
  const parent = prepared.find(item => item.libraryId === 'root');
  const nested = prepared.find(item => item.libraryId === 'child');
  assert.equal(parent.parentId, 'P');
  assert.equal(parent.rootId, undefined);
  assert.equal(nested.parentId, parent.id);
  assert.equal(nested.rootId, undefined);
  assert.equal(JSON.stringify([root, child]), before);
  assert.throws(() => prepare([root], { root: { mode: 'child', countryId: 'A', parentId: 'P' } }, [unit('P', 'B')]), /상위 객체/);
});

test('promotion clears active parents, preserves source refs/version/period, and reparents children', () => {
  const result = prepare([root, child], { root: { mode: 'root', name: 'New country' } });
  assert.equal(result[0].entityKind, 'general');
  assert.equal(result[0].parentId, '');
  assert.equal(result[0].rootId, undefined);
  assert.equal(result[0].name, 'New country');
  assert.equal(result[0].parentLibraryId, 'old-parent');
  assert.equal(result[0].geometryVersionId, 'v1');
  assert.equal(result[0].validFrom, '1900');
  assert.equal(result[1].parentId, 'root');
  assert.equal(result[1].rootId, undefined);
});

test('existing parent reuse and automatic linkage; missing ancestor only prompts once', () => {
  const refs = { 'old-parent': 'P', 'old-country': 'A' };
  assert.equal(prepare([root], {}, [unit('P')], refs)[0].parentId, 'P');
  assert.equal(missingLibraryOwnership([root, child], () => '', [country('A')], []).length, 1);
  assert.equal(prepare([root], {}, [unit('P')], { ...refs, root: 'P' }).length, 0);
});

test('invalid containing subunit and library cycles are rejected before application', () => {
  assert.throws(() => prepareLibraryOwnership({ descriptors: [root], choices: { root: { mode: 'child', countryId: 'A', parentId: 'P' } },
    countries: [country('A')], units: [unit('P')], resolve: () => '', allocateId: () => 'new', contains: () => false }), /포함되지/);
  assert.throws(() => prepare([{ ...root, parentLibraryId: 'child' }, child]), /순환/);
});
