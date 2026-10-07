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
const root = { entityId: 'root', entityKind: 'general', name: 'Root', parentEntityId: 'old-parent', geometry: {}, geometryVersionId: 'v1', validFrom: null, metadata: {sourceLifetime: {validFrom:'1900',validTo:null}} };
const child = { ...root, entityId: 'child', name: 'Child', parentEntityId: 'root' };
function prepare(descriptors, choices = {}, units = []) {
  let counter = 0;
  return prepareLibraryOwnership({ descriptors, choices, countries: [country('A'), country('B')], units,
    allocateId: () => `new-${++counter}`, contains: () => true });
}

test('missing ownership never matches names or assigns an arbitrary country; intermediate parent defaults sovereign', () => {
  assert.deepEqual(missingLibraryOwnership([root]), [{ entityId: 'root', name: 'Root', countryId: '' }]);
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

test('explicit country and nested parent apply once; children retain explicit parent identities', () => {
  const before = JSON.stringify([root, child]);
  const prepared = prepare([child, root], { root: { mode: 'child', countryId: 'B', parentId: 'P' } }, [unit('P', 'B')]);
  const parent = prepared.find(item => item.entityId === 'root');
  const nested = prepared.find(item => item.entityId === 'child');
  assert.equal(parent.parentId, 'P');
  assert.equal(parent.rootId, undefined);
  assert.equal(nested.parentId, parent.id);
  assert.equal(nested.rootId, undefined);
  assert.equal(JSON.stringify([root, child]), before);
  assert.throws(() => prepare([root], { root: { mode: 'child', countryId: 'A', parentId: 'P' } }, [unit('P', 'B')]), /상위 단위/);
});

test('promotion clears active parents, preserves source refs/version/period, and reparents children', () => {
  const result = prepare([root, child], { root: { mode: 'root', name: 'New country' } });
  assert.equal(result[0].entityKind, 'general');
  assert.equal(result[0].parentId, '');
  assert.equal(result[0].rootId, undefined);
  assert.equal(result[0].name, 'New country');
  assert.equal(result[0].parentEntityId, 'old-parent');
  assert.equal(result[0].geometryVersionId, 'v1');
  assert.equal(result[0].validFrom, null);
  assert.equal(result[0].metadata.sourceLifetime.validFrom,'1900');
  assert.equal(result[1].parentId, result[0].id);
  assert.notEqual(result[0].id, root.entityId);
  assert.equal(result[1].rootId, undefined);
});

test('source identity never reuses an existing instance or implicitly selects its parent', () => {
  assert.throws(() => prepare([root], {}, [unit('P')]), /소속/);
  assert.equal(missingLibraryOwnership([root, child]).length, 1);
  const descriptors=[{...root,parentEntityId:''}];
  const first=prepare(descriptors), second=prepareLibraryOwnership({descriptors,countries:[country('A'),country(first[0].id)],units:[],allocateId:()=> 'new-2'});
  assert.notEqual(first[0].id, second[0].id);
  assert.equal(second[0].entityId, root.entityId);
  assert.throws(()=>prepare([root,root]), /중복/);
});

test('invalid containing subunit and library cycles are rejected before application', () => {
  assert.throws(() => prepareLibraryOwnership({ descriptors: [root], choices: { root: { mode: 'child', countryId: 'A', parentId: 'P' } },
    countries: [country('A')], units: [unit('P')], allocateId: () => 'new', contains: () => false }), /포함되지/);
  assert.throws(() => prepare([{ ...root, parentEntityId: 'child' }, child]), /순환/);
});
