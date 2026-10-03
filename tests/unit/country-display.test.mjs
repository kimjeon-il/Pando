import { normalizeCountryFeature } from '../../assets/js/modules/country-feature.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { territorialSelectionStatus } from '../../assets/js/modules/country-display.js';

test('geographic names are displayed exactly as stored in the entity', () => {
  for (const [id, name] of [['ALD', '올란드'], ['FRO', '페로'], ['PCN', '핏케언'], ['MHL', '마셜'], ['CYM', '케이맨'], ['COK', '쿡'], ['SLB', '솔로몬'], ['FLK', '포클랜드'], ['MNP', '북마리아나'], ['CSI', '산호해']]) {
    assert.equal(readCountryName({ id, properties: { name: `${name}제도` } }), `${name}제도`);
    assert.equal(readCountryName({ id, properties: { name: `${name} 제도` } }), `${name} 제도`);
  }
  assert.equal(readCountryName({ id: 'custom', properties: { name: '내가 만든 제도' } }), '내가 만든 제도');
  assert.equal(readCountryName({ id: 'ALD', properties: { name: '사용자 올란드' } }), '사용자 올란드');
  assert.equal(readCountryName({ id: 'COD', properties: { name: '콩고 민주 공화국' } }), '콩고 민주 공화국');
});

test('canonical country names and custom names need no display-only replacement', () => {
  const turkey = { id: 'TUR', properties: { name: '튀르키예' } };
  assert.equal(readCountryName(turkey), '튀르키예');
  assert.equal(readCountryName({ id: 'ESP', properties: { name: '에스파냐' } }), '에스파냐');
  assert.equal(readCountryName({ id: 'TUR', properties: { name: '터키' } }), '터키');
  assert.equal(readCountryName(turkey, { name: '내 나라' }), '내 나라');
  assert.equal(readCountryName({ id: 'TUR', properties: { name: '사용자 국명' } }), '사용자 국명');
});
test('selection status shows the name and optional area without a type prefix or internal ID', () => {
  const view = { id: 'TUR', displayName: '튀르키예' };
  assert.equal(territorialSelectionStatus(view), '튀르키예');
  assert.equal(territorialSelectionStatus(view, '10 km²'), '튀르키예 · 10 km²');
  assert.equal(territorialSelectionStatus({ id: 'country-custom-123', displayName: '새 나라' }), '새 나라');
});

test('selection status preserves user names and does not mutate identity metadata', () => {
  const view = Object.freeze({ id: 'country-custom-123', type: 'country', displayName: '국가 · 내 나라 (TUR)' });
  assert.equal(territorialSelectionStatus(view), '국가 · 내 나라 (TUR)');
  assert.equal(territorialSelectionStatus(view, '0 km²'), '국가 · 내 나라 (TUR) · 0 km²');
  assert.equal(view.id, 'country-custom-123');
  assert.equal(view.type, 'country');
  assert.equal(view.displayName, '국가 · 내 나라 (TUR)');
});

test('renaming changes only the presented name before and after area calculation', () => {
  const original = Object.freeze({ id: 'TUR', displayName: '튀르키예' });
  const renamed = Object.freeze({ ...original, displayName: '내 나라' });
  assert.equal(territorialSelectionStatus(renamed), '내 나라');
  assert.equal(territorialSelectionStatus(renamed, '10 km²'), '내 나라 · 10 km²');
  assert.equal(renamed.id, original.id);
  assert.equal(original.displayName, '튀르키예');
});

function readCountryName(feature, override = {}) {
  const normalized = normalizeCountryFeature({ ...feature, geometry: { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[1,0],[0,0]]] } });
  const state = { territorialEntities: [normalized] };
  const store = createTerritorialEntityStore({ getState: () => state });
  if (Object.hasOwn(override, 'name')) store.setField('country', feature.id, 'name', override.name);
  return store.snapshot()[0].properties.name;
}
