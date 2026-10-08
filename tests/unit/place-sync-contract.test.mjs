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
    assert.equal(fixture.sourceReview.geonameId, Number(fixture.input.sourceId));
    assert.match(fixture.sourceReview.reviewFile, /^reports\/places\/tier1-major-cities-batch/u);
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


test('batch 01: Busan, Osaka and Beijing select one historically aligned native, Korean and English label at date boundaries', () => {
  const rows = JSON.parse(readFileSync(new URL('../../reports/places/tier1-major-cities-batch01.json', import.meta.url), 'utf8')).records;
  const record = id => {
    const matches = rows.filter(row => row.geonameId === id);
    assert.equal(matches.length, 1, 'One reviewed place per GeoNames ID: ' + id);
    return matches[0];
  };
  const at = (place, date) => {
    const selected = {
      native: place.defaultDisplayNameNative,
      ko: place.defaultDisplayNameKo,
      en: place.defaultDisplayNameEn,
      nativeLanguage: place.defaultNativeLanguage
    };
    let previous = '';
    for (const change of place.displayTimeline) {
      const from = change.fromDate ?? String(change.fromYear).padStart(4, '0') + '-01-01';
      assert.ok(from > previous, 'Chronological historical names for ' + place.geonameId);
      previous = from;
      if (from > date) break;
      if (change.nameNative !== undefined) selected.native = change.nameNative;
      if (change.nameKo !== undefined) selected.ko = change.nameKo;
      if (change.nameEn !== undefined) selected.en = change.nameEn;
      if (change.nativeLanguage !== undefined) selected.nativeLanguage = change.nativeLanguage;
    }
    return [selected.native, selected.ko, selected.en, selected.nativeLanguage];
  };
  const busan = record(1838524);
  assert.deepEqual(busan.displayTimeline.map(row => row.fromDate ?? row.fromYear),
    [1801, '1910-08-29', '1945-08-15', '2000-07-07']);
  for (const [date, expected] of [
    ['1910-08-28', ['釜山', '부산', 'Pusan', 'ko-Hani']],
    ['1910-08-29', ['釜山', '부산', 'Fusan', 'ja']],
    ['1945-08-14', ['釜山', '부산', 'Fusan', 'ja']],
    ['1945-08-15', ['부산', '부산', 'Pusan', 'ko']],
    ['2000-07-06', ['부산', '부산', 'Pusan', 'ko']],
    ['2000-07-07', ['부산', '부산', 'Busan', 'ko']]
  ]) assert.deepEqual(at(busan, date), expected, 'Busan ' + date);
  assert.ok(busan.displayTimeline[1].researchNote.includes('편집상'));
  assert.ok(busan.historicalGeography.linkedPlaces.some(x => x.nameKo === '동래부'));

  const osaka = record(1853909);
  assert.deepEqual(osaka.displayTimeline.map(row => row.fromDate ?? row.fromYear),
    [1801, '1868-06-21']);
  assert.deepEqual(at(osaka, '1868-06-20'), ['大坂', '오사카', 'Osaka', 'ja']);
  assert.deepEqual(at(osaka, '1868-06-21'), ['大阪', '오사카', 'Osaka', 'ja']);
  assert.ok(osaka.displayTimeline[1].researchNote.includes('편집상'));

  const beijing = record(1816670);
  assert.deepEqual(beijing.displayTimeline.map(row => row.fromDate ?? row.fromYear),
    [1801, '1912-01-01', '1928-06-28', '1937-10-12', '1945-08-15', '1949-09-27', '1979-01-01']);
  for (const [date, expected] of [
    ['1911-12-31', ['北京', '북경', 'Peking', 'zh']],
    ['1912-01-01', ['北京', '베이징', 'Peking', 'zh']],
    ['1928-06-27', ['北京', '베이징', 'Peking', 'zh']],
    ['1928-06-28', ['北平', '베이핑', 'Peiping', 'zh']],
    ['1937-10-11', ['北平', '베이핑', 'Peiping', 'zh']],
    ['1937-10-12', ['北京', '베이징', 'Peking', 'zh']],
    ['1945-08-14', ['北京', '베이징', 'Peking', 'zh']],
    ['1945-08-15', ['北平', '베이핑', 'Peiping', 'zh']],
    ['1949-09-26', ['北平', '베이핑', 'Peiping', 'zh']],
    ['1949-09-27', ['北京', '베이징', 'Peking', 'zh']],
    ['1978-12-31', ['北京', '베이징', 'Peking', 'zh']],
    ['1979-01-01', ['北京', '베이징', 'Beijing', 'zh']]
  ]) assert.deepEqual(at(beijing, date), expected, 'Beijing ' + date);
  assert.ok(beijing.names.some(n => n.text === '북경' && n.usage === 'historical' &&
    n.variantType === 'historicalKoreanSinoReading'));
  assert.ok(!beijing.names.some(n => n.text === 'Beiping' || n.text === '북평'));
  assert.deepEqual(Object.keys(beijing.displayTimeline.at(-1)).filter(k => k.startsWith('name')), ['nameEn']);

  for (const item of [busan, osaka, beijing]) {
    const unique = new Set(item.names.map(n => n.language + '\u0000' + n.text));
    assert.equal(unique.size, item.names.length, 'No duplicate language and text: ' + item.geonameId);
    for (const entry of item.displayTimeline) {
      assert.ok(Object.hasOwn(entry, 'fromYear') !== Object.hasOwn(entry, 'fromDate'),
        'Exactly one temporal precision: ' + item.geonameId);
    }
  }
});
