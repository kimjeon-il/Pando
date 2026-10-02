import test from 'node:test';
import assert from 'node:assert/strict';
import { countryDisplayName, territorialSelectionStatus, defaultGeographicName } from '../../assets/js/modules/country-display.js';

test('island names join the geographic suffix without stripping custom or compound names', () => {
  for (const [id, name] of [['ALD', '올란드'], ['FRO', '페로'], ['PCN', '핏케언'], ['MHL', '마셜'], ['CYM', '케이맨'], ['COK', '쿡'], ['SLB', '솔로몬'], ['FLK', '포클랜드'], ['MNP', '북마리아나'], ['CSI', '산호해']]) {
    assert.equal(defaultGeographicName(id, `${name} 제도`), `${name}제도`);
    assert.equal(defaultGeographicName(id, `${name}제도`), `${name}제도`);
  }
  assert.equal(defaultGeographicName('custom', '내가 만든 제도'), '내가 만든 제도');
  assert.equal(defaultGeographicName('ALD', '사용자 올란드'), '사용자 올란드');
  assert.equal(defaultGeographicName('COD', '콩고 민주 공화국'), '콩고 민주 공화국');
});

test('default country names are updated without replacing custom names', () => {
  const turkey = { id: 'TUR', properties: { name: '터키' } };
  assert.equal(countryDisplayName(turkey), '튀르키예');
  assert.equal(countryDisplayName({ id: 'ESP', properties: { name: '스페인' } }), '에스파냐');
  assert.equal(countryDisplayName(turkey, { name: '내 나라' }), '내 나라');
  assert.equal(countryDisplayName({ id: 'TUR', properties: { name: '사용자 국명' } }), '사용자 국명');
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
