import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  currentCountryFlagCode,
  currentCountryFlagUrl,
  effectiveCountryFlagUrl,
} from '../../assets/js/modules/country-flags.js';
import {
  EXPECTED_COUNTRY_FLAG_EXCLUDED_IDS,
  EXPECTED_COUNTRY_FLAG_LEGACY_4X3_CODES,
  EXPECTED_COUNTRY_FLAG_NATIVE_COUNT,
  EXPECTED_COUNTRY_FLAG_NATIVE_SOURCE,
  EXPECTED_COUNTRY_FLAG_SOURCE,
  EXPECTED_COUNTRY_FLAG_SUPPORTED_COUNT,
  EXPECTED_COUNTRY_FLAG_SPECIAL_IDS,
} from '../fixtures/country-flag-expectations.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const countries = JSON.parse(readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson'), 'utf8'));
const flagRoot = path.join(root, 'assets/vendor/flag-icons/7.5.0/flags/4x3');
const nativeFlagRoot = path.join(root, `assets/vendor/country-flags/${EXPECTED_COUNTRY_FLAG_NATIVE_SOURCE.revision}/svg`);

function viewBoxDimensions(source) {
  const match = source.match(/viewBox="([^"]+)"/);
  assert.ok(match, 'SVG must declare a viewBox');
  const values = match[1].trim().split(/\s+/).map(Number);
  assert.equal(values.length, 4);
  assert.ok(values[2] > 0 && values[3] > 0);
  return { width: values[2], height: values[3] };
}

test('canonical-source flag coverage includes 239 mapped codes and two special flags', () => {
  const countryIds = new Set(countries.features.map(feature => String(feature.id || '')));
  const supportedIds = [...countryIds].filter(id => currentCountryFlagUrl(id));
  const excludedIds = [...EXPECTED_COUNTRY_FLAG_EXCLUDED_IDS];
  assert.equal(countryIds.size, 258);
  assert.equal(supportedIds.length, EXPECTED_COUNTRY_FLAG_SUPPORTED_COUNT + EXPECTED_COUNTRY_FLAG_SPECIAL_IDS.length);
  assert.equal(excludedIds.length, 17);
  assert.equal(new Set([...supportedIds, ...excludedIds]).size, 258);
  assert.deepEqual(new Set([...supportedIds, ...excludedIds]), countryIds);
  assert.equal(supportedIds.some(id => excludedIds.includes(id)), false);
});

test('every mapped country uses its original-ratio or legacy 4x3 bundled SVG', () => {
  const codes = countries.features.map(feature => currentCountryFlagCode(feature.id)).filter(Boolean);
  const legacyCodes = new Set(EXPECTED_COUNTRY_FLAG_LEGACY_4X3_CODES);
  const nativeCodes = codes.filter(code => !legacyCodes.has(code));
  assert.equal(new Set(codes).size, EXPECTED_COUNTRY_FLAG_SUPPORTED_COUNT);
  assert.equal(nativeCodes.length, EXPECTED_COUNTRY_FLAG_NATIVE_COUNT);
  assert.equal(new Set(nativeCodes).size, EXPECTED_COUNTRY_FLAG_NATIVE_COUNT);
  for (const code of codes) {
    assert.match(code, /^[a-z]{2}$/);
    const isNative = nativeCodes.includes(code);
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
  assert.equal(EXPECTED_COUNTRY_FLAG_SOURCE.license, 'MIT');
  assert.equal(EXPECTED_COUNTRY_FLAG_NATIVE_SOURCE.license, 'Public Domain');
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
  for (const [code, expectedRatio] of Object.entries({ kr: 3 / 2, de: 5 / 3, fr: 3 / 2, no: 22 / 16, np: 71.571 / 87.246 })) {
    const { width, height } = viewBoxDimensions(readFileSync(path.join(nativeFlagRoot, `${code}.svg`), 'utf8'));
    assert.ok(Math.abs((width / height) - expectedRatio) < 0.001, `${code} native ratio changed`);
  }
  assert.match(currentCountryFlagUrl('KOR'), /country-flags\/c09927e63705529bbf59ca6684cd9b23225dddad\/svg\/kr\.svg$/);
  assert.match(currentCountryFlagUrl('DEU'), /country-flags\/c09927e63705529bbf59ca6684cd9b23225dddad\/svg\/de\.svg$/);
  assert.match(currentCountryFlagUrl('NOR'), /country-flags\/c09927e63705529bbf59ca6684cd9b23225dddad\/svg\/no\.svg$/);
  assert.match(currentCountryFlagUrl('GAB'), /flag-icons\/7\.5\.0\/flags\/4x3\/ga\.svg$/);
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

  const bundled = new URL(currentCountryFlagUrl('KOR', { assetRevision: 'test-build' }));
  assert.match(decodeURIComponent(bundled.pathname), /assets\/vendor\/country-flags\/c09927e63705529bbf59ca6684cd9b23225dddad\/svg\/kr\.svg$/);
  assert.equal(bundled.searchParams.get('v'), 'test-build');
});
