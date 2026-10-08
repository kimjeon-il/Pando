import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PLACE_LANGUAGES, PLACE_LIMITS, PLACE_TILE_FORMAT, normalizePlace,
  resolvePlaceLabelRows, DEFAULT_PLACE_LANGUAGES, togglePlaceLanguage } from '../../assets/js/modules/place-contract.js';
import { PLACE_LABEL_METRICS, placeLabelDimensions } from '../../assets/js/modules/label-layout.js';
import { encodePlaceTile, decodePlaceTile } from '../../assets/js/modules/place-codec.js';

const contract = JSON.parse(readFileSync(new URL('../../contracts/places/v2.json', import.meta.url), 'utf8'));
test('portable place contract exposes the exact binary and language policy', () => {
  assert.equal(contract.schema, 'pando-place-sync-v2');
  assert.equal(contract.dataContractVersion, PLACE_TILE_FORMAT.version);
  assert.equal(contract.wire.magicAscii, 'PLAC');
  assert.equal(contract.wire.recordBytes, 68);
  assert.deepEqual(contract.wire.stringFields, PLACE_TILE_FORMAT.stringFields);
  assert.deepEqual(contract.domain.languageOrder, PLACE_LANGUAGES);
  assert.deepEqual(contract.domain.defaultLanguages, DEFAULT_PLACE_LANGUAGES);
  assert.deepEqual(contract.display.webEstimatedBox, PLACE_LABEL_METRICS);
  assert.deepEqual(contract.limits, PLACE_LIMITS);
  assert.equal(togglePlaceLanguage({ ko: false, en: true, native: false }, 'en', false), null);
});
for (const fixture of contract.fixtures) {
  test('native-compatible PLAC v2 and reviewed multilingual results: ' + fixture.id, () => {
    const normalized = normalizePlace(fixture.input);
    assert.deepEqual(normalized, fixture.normalized);
    assert.deepEqual(decodePlaceTile(Buffer.from(fixture.tileHex, 'hex')), [normalized]);
    assert.equal(Buffer.from(encodePlaceTile([fixture.input])).toString('hex'), fixture.tileHex);
    for (const scenario of fixture.scenarios) {
      const actual = resolvePlaceLabelRows(normalized, scenario.languages, scenario.date)
        .map(row => [row.language, row.text]);
      assert.deepEqual(actual, scenario.rows);
      assert.deepEqual(placeLabelDimensions(actual.map(([, text]) => text)), scenario.webEstimatedBox);
    }
  });
}
