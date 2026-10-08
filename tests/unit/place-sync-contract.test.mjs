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


test('Delhi multilingual first-batch names change at approved historical thresholds', () => {
  const batch = JSON.parse(readFileSync(new URL('../../reports/places/tier1-major-cities-batch01.json', import.meta.url), 'utf8'));
  const matches = batch.records.filter(x => x.geonameId === 1273294);
  assert.equal(matches.length, 1);
  const city = matches[0];
  assert.equal(city.defaultDisplayNameKo, '델리');
  assert.equal(city.defaultDisplayNameEn, 'Delhi');
  assert.deepEqual(city.defaultNativeNames.map(x => [x.language, x.text]),
    [['hi','दिल्ली'], ['ur','دہلی'], ['pa','ਦਿੱਲੀ']]);
  assert.deepEqual(city.displayTimeline.map(x => x.fromDate ?? x.fromYear),
    [1801, '1858-11-01', '1947-08-15', '2004-01-26']);
  const at = date => {
    const state = { ko:city.defaultDisplayNameKo, en:city.defaultDisplayNameEn,
      names:city.defaultNativeNames, primary:city.defaultDisplayNameNative };
    let previous = '';
    for (const change of city.displayTimeline) {
      const from = change.fromDate ?? String(change.fromYear).padStart(4,'0')+'-01-01';
      assert.ok(from>previous, 'Unsorted Delhi history');
      previous = from;
      if(from>date) break;
      if(change.nameKo!==undefined)state.ko=change.nameKo;
      if(change.nameEn!==undefined)state.en=change.nameEn;
      if(change.nameNative!==undefined)state.primary=change.nameNative;
      if(change.nativeNames!==undefined)state.names=change.nativeNames;
    }
    assert.equal(state.names[0].text,state.primary,'Primary must equal first native form');
    assert.ok(state.names.length>=1 && state.names.length<=3);
    assert.equal(new Set(state.names.map(x=>x.language)).size,state.names.length);
    return [state.ko,state.en,state.names.map(x=>[x.language,x.text])];
  };
  for (const [date,names] of [
    ['1858-10-31', [['fa','دهلی']]],
    ['1858-11-01', [['ur','دہلی']]],
    ['1947-08-14', [['ur','دہلی']]],
    ['1947-08-15', [['hi','दिल्ली'],['ur','دہلی']]],
    ['2004-01-25', [['hi','दिल्ली'],['ur','دہلی']]],
    ['2004-01-26', [['hi','दिल्ली'],['ur','دہلی'],['pa','ਦਿੱਲੀ']]],
    ['2026-10-09', [['hi','दिल्ली'],['ur','دہلی'],['pa','ਦਿੱਲੀ']]]
  ])assert.deepEqual(at(date),['델리','Delhi',names],date);
  for(const event of city.displayTimeline) {
    assert.ok(Object.hasOwn(event,'fromDate')!==Object.hasOwn(event,'fromYear'));
    assert.ok(event.sourceUrl&&event.researchNote);
    for(const native of event.nativeNames) {
      assert.ok(native.language&&native.script);
      assert.ok(city.names.some(row=>row.language===native.language && row.text===native.text));
    }
  }
  assert.ok(city.displayTimeline[1].researchNote.includes('편집상'));
  assert.ok(city.displayTimeline[2].researchNote.includes('편집상'));
  assert.ok(city.displayTimeline[3].researchNote.includes('2004-01-26'));
  assert.ok(city.nameSelectionNotes.some(x=>x.includes('1837년')));
  assert.ok(!city.names.some(x=>['Dilli','Dehli','New Delhi','Shahjahanabad'].includes(x.text)));
  const policy = JSON.parse(readFileSync(new URL('../../reports/places/historical-display-policy.json', import.meta.url), 'utf8')).preferredNameSelection;
  assert.equal(policy.maxPreferredNamesPerSlotAtAnyInstant.ko,1);
  assert.equal(policy.maxPreferredNamesPerSlotAtAnyInstant.en,1);
  assert.equal(policy.maxPreferredNamesPerSlotAtAnyInstant.native,3);
  assert.equal(policy.nativeNameCardinality.normalNativeNames,1);
});


test('Incheon temporary Jemulpo and Korean historical romanization boundaries', () => {
  const data = JSON.parse(readFileSync(new URL('../../reports/places/tier1-major-cities-batch02-east-asia.json', import.meta.url), 'utf8'));
  const byId = Object.fromEntries(data.records.map(r => [r.geonameId, r]));
  const history = (id, date) => {
    const r = byId[id];
    assert.ok(r);
    const s = {ko:r.defaultDisplayNameKo,en:r.defaultDisplayNameEn,
      native:r.defaultDisplayNameNative,language:r.defaultNativeLanguage};
    let prev = '';
    for (const t of r.displayTimeline) {
      const when = t.fromDate ?? String(t.fromYear).padStart(4,'0')+'-01-01';
      assert.ok(when>prev, 'Sorted name changes');
      prev = when;
      if(when>date)break;
      if(t.nameKo!==undefined)s.ko=t.nameKo;
      if(t.nameEn!==undefined)s.en=t.nameEn;
      if(t.nameNative!==undefined)s.native=t.nameNative;
      if(t.nativeLanguage!==undefined)s.language=t.nativeLanguage;
    }
    return [s.ko,s.en,s.native,s.language];
  };
  const cases = [
    [1843564,'1900-01-01',['인천','Inchon','仁川','ko-Hani']],
    [1843564,'1910-08-28',['인천','Inchon','仁川','ko-Hani']],
    [1843564,'1910-08-29',['인천','Jinsen','仁川','ja']],
    [1843564,'1945-08-14',['인천','Jinsen','仁川','ja']],
    [1843564,'1945-08-15',['인천','Inchon','인천','ko']],
    [1843564,'1945-10-09',['인천','Inchon','인천','ko']],
    [1843564,'1945-10-10',['제물포','Chemulpo','제물포','ko']],
    [1843564,'1945-10-27',['제물포','Chemulpo','제물포','ko']],
    [1843564,'1945-10-28',['인천','Inchon','인천','ko']],
    [1843564,'2000-07-06',['인천','Inchon','인천','ko']],
    [1843564,'2000-07-07',['인천','Incheon','인천','ko']],
    [1835329,'1900-01-01',['대구','Taegu','大邱','ko-Hani']],
    [1835329,'1910-08-29',['대구','Taikyu','大邱','ja']],
    [1835329,'1945-08-15',['대구','Taegu','대구','ko']],
    [1835329,'2000-07-07',['대구','Daegu','대구','ko']],
    [1835235,'1900-01-01',['대전','Taejon','大田','ko-Hani']],
    [1835235,'1910-08-29',['대전','Taiden','大田','ja']],
    [1835235,'1945-08-15',['대전','Taejon','대전','ko']],
    [1835235,'2000-07-07',['대전','Daejeon','대전','ko']]
  ];
  for(const [id,date,names] of cases)
    assert.deepEqual(history(id,date),names,id+' / '+date);
  assert.deepEqual(data.historicalNameReview.reviewedGeoNamesIds,
    [1843564,1835329,1835235]);
  assert.equal(data.historicalNameReview.pendingGeoNamesIds.length,6);
  assert.equal(data.historicalNameReview.gradeTimelineStatus,'not-decided-or-modified');
  assert.deepEqual(data.records.find(r=>r.geonameId===1843564).displayTimeline.map(
    t=>t.fromDate??t.fromYear),
    [1801,'1910-08-29','1945-08-15','1945-10-10','1945-10-28','2000-07-07']);
  assert.ok(data.records.find(r=>r.geonameId===1835235).nameSelectionNotes.some(
    t=>t.includes('1801년')));
});


test('review-only city lifecycle interval contract covers rise, extinction, gaps and unknown years', () => {
  const p = JSON.parse(readFileSync(new URL('../../reports/places/historical-display-policy.json', import.meta.url), 'utf8'));
  const cfg = p.temporalEligibility;
  assert.equal(cfg.futureIntervalsField, 'activeIntervals');
  assert.equal(cfg.reviewStatusField, 'lifecycleReviewStatus');
  assert.deepEqual(cfg.reviewStatusValues, ['unreviewed','provisional','verified']);
  assert.deepEqual(cfg.boundarySemantics.resultValues, ['eligible','ineligible','unresolved']);
  for (const key of ['cityEstablishedFromYear','cityEstablishedFromDate','beforeCityEstablished'])
    assert.ok(cfg.legacyCompatibility.supportedFields.includes(key));
  assert.ok(p.historicalCityIdentity.separateIdentityRule.includes('separate city records/IDs'));
  assert.ok(p.lifecycleFollowup.explicitlyDeferred.includes('City-grade timeline'));
  const status = (period,date) => {
    const y = date.slice(0,4);
    const start = period.fromDate != null
      ? date >= period.fromDate ? true : false
      : period.fromYear != null
      ? y < String(period.fromYear) ? false : y === String(period.fromYear) ? null : true
      : true;
    const end = period.untilDateExclusive != null
      ? date < period.untilDateExclusive ? true : false
      : period.untilYear != null
      ? y < String(period.untilYear) ? true : y === String(period.untilYear) ? null : false
      : true;
    if (start === false || end === false) return 'ineligible';
    if (start === null || end === null) return 'unresolved';
    return 'eligible';
  };
  const at = (caseData,date) => {
    if (caseData.lifecycleReviewStatus !== 'verified') return 'unresolved';
    const covered = status(caseData.reviewedCoverage,date);
    if (covered !== 'eligible') return 'unresolved';
    const episodes = caseData.activeIntervals.map(period=>status(period,date));
    if (episodes.includes('eligible')) return 'eligible';
    if (episodes.includes('unresolved')) return 'unresolved';
    return 'ineligible';
  };
  const scope = {fromDate:'1000-01-01',untilDateExclusive:'2100-01-01'};
  const newer = {lifecycleReviewStatus:'verified',reviewedCoverage:scope,
    activeIntervals:[{fromDate:'1859-07-01'}]};
  assert.equal(at(newer,'1859-06-30'),'ineligible');
  assert.equal(at(newer,'1859-07-01'),'eligible');
  const vanished = {lifecycleReviewStatus:'verified',reviewedCoverage:scope,
    activeIntervals:[{untilDateExclusive:'1750-04-18'}]};
  assert.equal(at(vanished,'1750-04-17'),'eligible');
  assert.equal(at(vanished,'1750-04-18'),'ineligible');
  const rebuilt = {lifecycleReviewStatus:'verified',reviewedCoverage:scope,
    activeIntervals:[
      {fromDate:'1600-01-01',untilDateExclusive:'1650-01-01'},
      {fromDate:'1700-01-01'}
    ]};
  assert.equal(at(rebuilt,'1649-12-31'),'eligible');
  assert.equal(at(rebuilt,'1650-01-01'),'ineligible');
  assert.equal(at(rebuilt,'1700-01-01'),'eligible');
  const uncertainYear = {lifecycleReviewStatus:'verified',reviewedCoverage:scope,
    activeIntervals:[{fromYear:1859,untilYear:1950}]};
  assert.equal(at(uncertainYear,'1858-12-31'),'ineligible');
  assert.equal(at(uncertainYear,'1859-06-01'),'unresolved');
  assert.equal(at(uncertainYear,'1860-01-01'),'eligible');
  assert.equal(at(uncertainYear,'1950-06-01'),'unresolved');
  assert.equal(at(uncertainYear,'1951-01-01'),'ineligible');
  assert.equal(at({...newer,lifecycleReviewStatus:'provisional'},'1900-01-01'),'unresolved');
  assert.equal(at(newer,'0900-01-01'),'unresolved');
  const central = JSON.parse(readFileSync(new URL('../../reports/places/tier1-major-cities-batch15-central-asia-capitals.json', import.meta.url), 'utf8'));
  for (const [id,year] of [[1526273,1830],[1528675,1868],[162183,1881]]) {
    const city=central.records.find(x=>x.geonameId===id);
    assert.equal(city.temporalEligibility.cityEstablishedFromYear,year);
    assert.equal(Object.hasOwn(city.temporalEligibility,'activeIntervals'),false);
  }
  const east = JSON.parse(readFileSync(new URL('../../reports/places/tier1-major-cities-batch02-east-asia.json', import.meta.url), 'utf8'));
  for (const id of [1848354,1835235]) {
    const city=east.records.find(x=>x.geonameId===id);
    assert.ok(city);
    assert.equal(Object.hasOwn(city,'temporalEligibility'),false,
      'Do not preassign Yokohama or Daejeon dates while historic tier threshold is deferred');
  }
});
