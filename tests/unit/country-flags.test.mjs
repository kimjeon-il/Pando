import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COUNTRY_FLAG_NATIVE_SOURCE,
  COUNTRY_FLAG_SOURCE,
  CURRENT_COUNTRY_FLAG_CODES,
  CURRENT_COUNTRY_FLAG_EXCLUDED_IDS,
  CURRENT_COUNTRY_FLAG_NATIVE_CODES,
  currentCountryFlagCode,
  currentCountryFlagUrl,
  effectiveCountryFlagUrl,
} from '../../assets/js/modules/country-flags.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const countries = JSON.parse(readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson'), 'utf8'));
const flagRoot = path.join(root, 'assets/vendor/flag-icons/7.5.0/flags/4x3');
const nativeFlagRoot = path.join(root, 'assets/vendor/country-flags/c09927e63705529bbf59ca6684cd9b23225dddad/svg');

function viewBoxDimensions(source) {
  const match = source.match(/viewBox="([^\"]+)"/);
  assert.ok(match, 'SVG must declare a viewBox');
  const values = match[1].trim().split(/\s+/).map(Number);
  assert.equal(values.length, 4);
  assert.ok(values[2] > 0 && values[3] > 0);
  return { width: values[2], height: values[3] };
}

test('current-country flag coverage is fixed at 239 supported and 19 explicit exclusions', () => {
  const countryIds = new Set(countries.features.map(feature => String(feature.id || '')));
  const supportedIds = Object.keys(CURRENT_COUNTRY_FLAG_CODES);
  const excludedIds = [...CURRENT_COUNTRY_FLAG_EXCLUDED_IDS];
  assert.equal(countryIds.size, 258);
  assert.equal(supportedIds.length, 239);
  assert.equal(excludedIds.length, 19);
  assert.equal(new Set([...supportedIds, ...excludedIds]).size, 258);
  assert.deepEqual(new Set([...supportedIds, ...excludedIds]), countryIds);
  assert.equal(supportedIds.some(id => excludedIds.includes(id)), false);
});

test('every mapped country uses its original-ratio or legacy 4x3 bundled SVG', () => {
  const codes = Object.values(CURRENT_COUNTRY_FLAG_CODES);
  assert.equal(new Set(codes).size, 239);
  assert.equal(CURRENT_COUNTRY_FLAG_NATIVE_CODES.length, 235);
  assert.equal(new Set(CURRENT_COUNTRY_FLAG_NATIVE_CODES).size, 235);
  for (const code of codes) {
    assert.match(code, /^[a-z]{2}$/);
    const isNative = CURRENT_COUNTRY_FLAG_NATIVE_CODES.includes(code);
    const assetPath = path.join(isNative ? nativeFlagRoot : flagRoot, `${code}.svg`);
    assert.equal(existsSync(assetPath), true, `missing flag asset ${code}.svg`);
    const source = readFileSync(assetPath, 'utf8');
    assert.match(source, /^<svg\b/);
    const { width, height } = viewBoxDimensions(source);
    if (isNative) assert.notEqual(width / height, 4 / 3);
    else assert.equal(width / height, 4 / 3);
  }
  assert.equal(existsSync(path.join(root, 'assets/vendor/flag-icons/7.5.0/LICENSE')), true);
  assert.equal(existsSync(path.join(nativeFlagRoot, '..', 'NOTICE')), true);
  assert.deepEqual(COUNTRY_FLAG_SOURCE, {
    name: 'flag-icons', version: '7.5.0', license: 'MIT', url: 'https://github.com/lipis/flag-icons',
  });
  assert.deepEqual(COUNTRY_FLAG_NATIVE_SOURCE, {
    name: 'country-flags', revision: 'c09927e63705529bbf59ca6684cd9b23225dddad',
    license: 'Public Domain', url: 'https://github.com/hampusborgos/country-flags',
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
  assert.match(currentCountryFlagUrl('KOR'), /country-flags\/c09927e63705529bbf59ca6684cd9b23225dddad\/svg\/kr\.svg$/);
  assert.match(currentCountryFlagUrl('DEU'), /country-flags\/c09927e63705529bbf59ca6684cd9b23225dddad\/svg\/de\.svg$/);
  assert.match(currentCountryFlagUrl('NOR'), /country-flags\/c09927e63705529bbf59ca6684cd9b23225dddad\/svg\/no\.svg$/);
  assert.match(currentCountryFlagUrl('LAO'), /flag-icons\/7\.5\.0\/flags\/4x3\/la\.svg$/);
});

test('effective flags honor project overrides, the built-in default, and explicit-none precedence', () => {
  const custom = 'data:image/svg+xml;base64,PHN2Zy8+';
  assert.equal(effectiveCountryFlagUrl({
    countryId: 'KOR', override: { flagDataUrl: custom },
  }), custom);
  assert.equal(effectiveCountryFlagUrl({
    countryId: 'KOR', override: { flagDataUrl: null },
  }), null);
  assert.match(effectiveCountryFlagUrl({ countryId: 'KOR' }), /\/kr\.svg$/);
  assert.equal(effectiveCountryFlagUrl({ countryId: 'BRT' }), null);

  const bundled = new URL(currentCountryFlagUrl('KOR', { assetRevision: '0.30.0-r44' }));
  assert.match(decodeURIComponent(bundled.pathname), /assets\/vendor\/country-flags\/c09927e63705529bbf59ca6684cd9b23225dddad\/svg\/kr\.svg$/);
  assert.equal(bundled.searchParams.get('v'), '0.30.0-r44');
});
