import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COLOR_DOMAINS,
  readDomainColor,
  writeDomainColor,
  resolveTerritorialColor,
  countryDefaultColor,
} from '../../assets/js/modules/color-adapter.js';

test('common color adapter reads each editable domain and reports defaults', () => {
  const country = { properties: { entityKind: 'general', parentId: '', name: '테스트국', style: { color: '#112233' } } };
  const territorial = { properties: { style: { color: '#223344' } } };
  const genericFeature = { properties: { color: '#334455' } };
  const layer = { color: '#445566' };
  assert.equal(readDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature: country }).value, '#112233');
  assert.equal(readDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature: territorial }).value, '#223344');
  assert.equal(readDomainColor(COLOR_DOMAINS.GENERIC, { feature: genericFeature }).value, '#334455');
  assert.equal(readDomainColor(COLOR_DOMAINS.DISTRIBUTION, { layer }).value, '#445566');
  assert.deepEqual(readDomainColor(COLOR_DOMAINS.GENERIC, { feature: { properties: {} } }, { fallback: '#abcdef' }), {
    explicit: '', value: '#abcdef', isDefault: true,
  });
  assert.deepEqual(readDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature: { properties: { name: '테스트국', style: { color: 'invalid' } } } }, { fallback: '#abcdef' }), {
    explicit: '', value: '#abcdef', isDefault: true,
  });
});

test('general colors inherit through parents while an independent region uses its own default', () => {
  const root = { id: 'A', properties: { entityKind: 'general', parentId: '', style: {} } };
  const child = { id: 'B', properties: { entityKind: 'general', parentId: 'A', style: {} } };
  const region = { id: 'R', properties: { entityKind: 'regional', parentId: '', style: {} } };
  const options = { entityRepository: { parent: id => id === 'B' ? root : null }, countryColor: () => '#112233', fallback: '#aabbcc' };
  assert.equal(resolveTerritorialColor(child, options), '#112233');
  assert.equal(resolveTerritorialColor(region, options), '#aabbcc');
  region.properties.style.color = '#abcdef';
  assert.equal(resolveTerritorialColor(region, options), '#abcdef');
  child.properties.parentId = 'missing';
  assert.throws(() => resolveTerritorialColor(child, { ...options, entityRepository: { parent: () => null } }), /상위 객체/);
});

test('common color adapter writes and clears canonical color fields', () => {
  const feature = { properties: {} };

  writeDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature }, '#AABBCC');
  assert.equal(feature.properties.style.color, '#aabbcc');
  writeDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature }, '', { clear: true });
  assert.deepEqual(feature.properties.style, {});
  assert.equal('color' in feature.properties.style, false);

  const territorial = { properties: {} };
  const genericFeature = { properties: {} };
  const layer = {};
  writeDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature: territorial }, '#123456');
  writeDomainColor(COLOR_DOMAINS.GENERIC, { feature: genericFeature }, '#234567');
  writeDomainColor(COLOR_DOMAINS.DISTRIBUTION, { layer }, '#345678');
  assert.equal(territorial.properties.style.color, '#123456');
  assert.equal(genericFeature.properties.color, '#234567');
  assert.equal(layer.color, '#345678');
});

test('country defaults follow canonical library identity rather than instance ID or edited name', () => {
  const feature = { id: 'library-instance', properties: { entityKind: 'general', parentId: '',
    name: '사용자가 바꾼 이름', sourceEntityId: 'state:west-prussia', style: { color: '#ff0000' } } };
  assert.equal(countryDefaultColor(feature), '#003153');
  feature.properties.sourceEntityId = 'state:KOR';
  feature.properties.metadata = { sourceFeatureId: 'KOR' };
  assert.equal(countryDefaultColor(feature), '#003478');
  feature.properties.entityKind = 'regional';
  assert.equal(countryDefaultColor(feature), '');
});
