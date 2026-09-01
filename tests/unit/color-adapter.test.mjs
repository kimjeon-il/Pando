import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COLOR_DOMAINS,
  readDomainColor,
  writeDomainColor,
} from '../../assets/js/modules/color-adapter.js';

test('common color adapter reads each editable domain and reports defaults', () => {
  const country = { properties: { editor_color: '#112233' } };
  const territorial = { properties: { style: { color: '#223344' } } };
  const genericFeature = { properties: { color: '#334455' } };
  const layer = { color: '#445566' };
  assert.equal(readDomainColor(COLOR_DOMAINS.COUNTRY, { feature: country }).value, '#112233');
  assert.equal(readDomainColor(COLOR_DOMAINS.TERRITORIAL, { feature: territorial }).value, '#223344');
  assert.equal(readDomainColor(COLOR_DOMAINS.GENERIC, { feature: genericFeature }).value, '#334455');
  assert.equal(readDomainColor(COLOR_DOMAINS.DISTRIBUTION, { layer }).value, '#445566');
  assert.deepEqual(readDomainColor(COLOR_DOMAINS.GENERIC, { feature: { properties: {} } }, { fallback: '#abcdef' }), {
    explicit: '', value: '#abcdef', isDefault: true,
  });
  assert.deepEqual(readDomainColor(COLOR_DOMAINS.COUNTRY, { feature: { properties: { editor_color: 'invalid' } } }, { fallback: '#abcdef' }), {
    explicit: '', value: '#abcdef', isDefault: true,
  });
});

test('common color adapter writes and clears canonical color fields', () => {
  const feature = { properties: {} };
  const override = {};
  writeDomainColor(COLOR_DOMAINS.COUNTRY, { feature, override }, '#AABBCC');
  assert.equal(feature.properties.editor_color, '#aabbcc');
  assert.equal(override.color, '#aabbcc');
  writeDomainColor(COLOR_DOMAINS.COUNTRY, { feature, override }, '', { clear: true });
  assert.equal('editor_color' in feature.properties, false);
  assert.equal('color' in override, false);

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
