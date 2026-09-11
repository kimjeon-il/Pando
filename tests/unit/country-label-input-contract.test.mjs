import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

test('automatic country names dispatch once to the shared ground input handler', () => {
  const rendering = read('assets/js/modules/rendering-domain.js');
  const countryLabels = rendering.slice(rendering.indexOf('const renderCountryLabels ='), rendering.indexOf('enter.append(\'image\')', rendering.indexOf('const renderCountryLabels =')));
  assert.match(countryLabels, /attr\('class', 'country-label-item'\)/);
  assert.doesNotMatch(countryLabels, /forcedRef|toggleNewCountrySource|toggleAnnexDonor|toggleMergeTarget|toggleBoundaryEditCountry/);
  assert.match(countryLabels, /if \(labels\.mapClickBlocked\?\.\(\)\) return;/);
  assert.match(countryLabels, /stopPropagation\(\);\s*labels\.handleMapClick\(labels\.d3\.mouse\(labels\.svg\.node\(\)\)\)/);
  const input = read('assets/js/modules/map-input-presentation.js');
  assert.match(input, /svg\.on\('click', function\(\)\s*\{\s*if \(mapClickBlocked\(\)\) return;\s*handleMapClick\(d3\.mouse\(this\)\);/);
});
