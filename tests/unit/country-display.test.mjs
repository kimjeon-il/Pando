import test from 'node:test';
import assert from 'node:assert/strict';
import { countryDisplayName, countrySelectionStatus, defaultGeographicName } from '../../assets/js/modules/country-display.js';

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
test('selection status retains code before and after area calculation, without UUIDs', () => {
  const view = { id: 'TUR', displayName: '튀르키예' };
  assert.equal(countrySelectionStatus(view), '국가 · 튀르키예 · TUR');
  assert.equal(countrySelectionStatus(view, '10 km²'), '국가 · 튀르키예 · TUR · 10 km²');
  assert.equal(countrySelectionStatus({ id: 'country-custom-123', displayName: '새 나라' }), '국가 · 새 나라');
});
