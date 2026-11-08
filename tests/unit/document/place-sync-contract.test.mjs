import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PLACE_LANGUAGES, PLACE_LIMITS, PLACE_TILE_FORMAT, normalizePlace, DEFAULT_PLACE_LANGUAGES, togglePlaceLanguage } from "../../../src/document/place-contract.js";
import { resolvePlaceLabelRows } from "../../../src/ui/place-name-display.js";
import { PLACE_LABEL_METRICS, placeLabelDimensions } from "../../../src/rendering/label-layout.js";
import { encodePlaceTile, decodePlaceTile } from "../../../src/data/place-codec.js";

const contract = JSON.parse(readFileSync(new URL("../../../contracts/places/v3.json", import.meta.url), 'utf8'));
test('portable place contract exposes the exact binary and language policy', () => {
  assert.equal(contract.schema, 'pando-place-sync-v3');
  assert.equal(contract.dataContractVersion, PLACE_TILE_FORMAT.version);
  assert.equal(contract.wire.magicAscii, 'PLAC');
  assert.equal(contract.wire.recordBytes, 72);
  assert.equal(contract.wire.stringFields.length, 9);
  assert.equal(contract.domain.maxNativeNames, 3);
  assert.deepEqual(contract.wire.stringFields, PLACE_TILE_FORMAT.stringFields);
  assert.deepEqual(contract.domain.languageOrder, PLACE_LANGUAGES);
  assert.deepEqual(contract.domain.defaultLanguages, DEFAULT_PLACE_LANGUAGES);
  assert.deepEqual(contract.display.webEstimatedBox, PLACE_LABEL_METRICS);
  assert.deepEqual(contract.limits, PLACE_LIMITS);
  assert.equal(togglePlaceLanguage({ ko: false, en: true, native: false }, 'en', false), null);
});
for (const fixture of contract.fixtures) {
  test('native-compatible PLAC v3 and reviewed multilingual results: ' + fixture.id, () => {
    const normalized = normalizePlace(fixture.input);
    assert.deepEqual(decodePlaceTile(Buffer.from(fixture.tileHex, 'hex')), [normalized]);
    assert.equal(Buffer.from(encodePlaceTile([fixture.input])).toString('hex'), fixture.tileHex);
    for (const scenario of fixture.scenarios) {
      const actual = resolvePlaceLabelRows(normalized, scenario.languages, scenario.date)
        .map(row => [row.language, row.text]);
      assert.deepEqual(actual, scenario.rows);
      assert.equal(placeLabelDimensions(actual.map(([, text]) => text)).height,
        PLACE_LABEL_METRICS.firstLineHeight + Math.max(0, actual.length - 1) * PLACE_LABEL_METRICS.extraLineHeight);
    }
  });
}
