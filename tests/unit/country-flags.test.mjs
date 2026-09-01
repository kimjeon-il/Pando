import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COUNTRY_FLAG_SOURCE,
  CURRENT_COUNTRY_FLAG_CODES,
  CURRENT_COUNTRY_FLAG_EXCLUDED_IDS,
  currentCountryFlagCode,
  currentCountryFlagUrl,
  effectiveCountryFlagUrl,
} from '../../assets/js/modules/country-flags.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const countries = JSON.parse(readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson'), 'utf8'));
const flagRoot = path.join(root, 'assets/vendor/flag-icons/7.5.0/flags/4x3');

test('current-country flag coverage is fixed at 239 supported and 19 explicit exclusions', () => {
  const countryIds = new Set(countries.features.map(feature => String(feature.properties?.editor_id || '')));
  const supportedIds = Object.keys(CURRENT_COUNTRY_FLAG_CODES);
  const excludedIds = [...CURRENT_COUNTRY_FLAG_EXCLUDED_IDS];
  assert.equal(countryIds.size, 258);
  assert.equal(supportedIds.length, 239);
  assert.equal(excludedIds.length, 19);
  assert.equal(new Set([...supportedIds, ...excludedIds]).size, 258);
  assert.deepEqual(new Set([...supportedIds, ...excludedIds]), countryIds);
  assert.equal(supportedIds.some(id => excludedIds.includes(id)), false);
});

test('every mapped country uses one bundled 4x3 SVG from the pinned source', () => {
  const codes = Object.values(CURRENT_COUNTRY_FLAG_CODES);
  assert.equal(new Set(codes).size, 239);
  for (const code of codes) {
    assert.match(code, /^[a-z]{2}$/);
    const assetPath = path.join(flagRoot, `${code}.svg`);
    assert.equal(existsSync(assetPath), true, `missing flag asset ${code}.svg`);
    const source = readFileSync(assetPath, 'utf8');
    assert.match(source, /^<svg\b/);
    assert.match(source, /viewBox="0 0 640 480"/);
  }
  assert.equal(existsSync(path.join(root, 'assets/vendor/flag-icons/7.5.0/LICENSE')), true);
  assert.deepEqual(COUNTRY_FLAG_SOURCE, {
    name: 'flag-icons', version: '7.5.0', license: 'MIT', url: 'https://github.com/lipis/flag-icons',
  });
});

test('representative and exceptional country IDs resolve to the intended flags', () => {
  assert.equal(currentCountryFlagCode('KOR'), 'kr');
  assert.equal(currentCountryFlagCode('DEU'), 'de');
  assert.equal(currentCountryFlagCode('PSX'), 'ps');
  assert.equal(currentCountryFlagCode('SAH'), 'eh');
  assert.equal(currentCountryFlagCode('TWN'), 'tw');
  assert.equal(currentCountryFlagCode('KOS'), 'xk');
  assert.equal(currentCountryFlagCode('FRA'), 'fr');
  assert.equal(currentCountryFlagCode('NOR'), 'no');
  assert.equal(currentCountryFlagCode('BRT'), '');
});

test('effective flags honor override, feature, default, and explicit-none precedence', () => {
  const custom = 'data:image/svg+xml;base64,PHN2Zy8+';
  const imported = 'data:image/png;base64,aW1wb3J0ZWQ=';
  assert.equal(effectiveCountryFlagUrl({
    countryId: 'KOR', properties: { flagDataUrl: imported }, override: { flagDataUrl: custom },
  }), custom);
  assert.equal(effectiveCountryFlagUrl({
    countryId: 'KOR', properties: { flagDataUrl: imported }, override: { flagDataUrl: null },
  }), null);
  assert.equal(effectiveCountryFlagUrl({ countryId: 'KOR', properties: { flagDataUrl: imported } }), imported);
  assert.equal(effectiveCountryFlagUrl({ countryId: 'KOR', properties: { flagDataUrl: null } }), null);
  assert.equal(effectiveCountryFlagUrl({ countryId: 'BRT' }), null);

  const bundled = new URL(currentCountryFlagUrl('KOR', { assetRevision: '0.30.0-r41' }));
  assert.match(decodeURIComponent(bundled.pathname), /assets\/vendor\/flag-icons\/7\.5\.0\/flags\/4x3\/kr\.svg$/);
  assert.equal(bundled.searchParams.get('v'), '0.30.0-r41');
});
