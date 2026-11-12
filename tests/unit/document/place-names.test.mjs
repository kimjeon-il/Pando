import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePlace, normalizePlaceLanguages, togglePlaceLanguage } from "../../../src/document/place-contract.js";
import { resolvePlaceLabelRows, placeLabelRowsAtMonth } from "../../../src/ui/place-name-display.js";
import { placeLabelDimensions, layoutLabels } from "../../../src/rendering/label-layout.js";
import { mapPlaceLabelRowsAtMonth, PLACE_NATIVE_LABEL_MIN_ZOOM } from "../../../src/data/place-name-policy.js";

const place = changes => normalizePlace({source:'geonames',sourceId:'703448',name:'키이우',nameEn:'Kyiv',nameNative:'Київ',
  kind:'capital',coordinates:[30.52,50.45],nameTimeline:[{fromYear:1801,ko:'키예프'},{fromDate:'1991-08-24',ko:'키이우'}],...changes});
test('one monthly place projection supplies search and drawing without claiming ancient existence',()=>{
  assert.deepEqual(placeLabelRowsAtMonth(place(),'1990-01',{ko:true}).map(row=>row.text),['키예프']);
  assert.deepEqual(placeLabelRowsAtMonth(place(),'-0044-03',{ko:true}),[]);
  assert.deepEqual(placeLabelRowsAtMonth(place(),'2026-10',{ko:true}).map(row=>row.text),['키이우']);
});
test('Korean, English and native lines are independently selectable and ordered',()=>{
  const record=place();
  assert.deepEqual(resolvePlaceLabelRows(record,{ko:true,en:true,native:true}).map(row=>row.text),['키이우','Kyiv','Київ']);
  assert.deepEqual(resolvePlaceLabelRows(record,{ko:false,en:true,native:true}).map(row=>row.text),['Kyiv','Київ']);
  assert.deepEqual(resolvePlaceLabelRows(record,{ko:false,en:false,native:true}).map(row=>row.text),['Київ']);
  assert.deepEqual(resolvePlaceLabelRows(record,{ko:true,en:false,native:false}).map(row=>row.text),['키이우']);
});
test('per-language evidence marks missing English and native history as current names',()=>{
  const record=place();
  assert.deepEqual(resolvePlaceLabelRows(record,{ko:true,en:true,native:true},'1990-01-01').map(row=>row.text),['키예프','(현)Kyiv','(현)Київ']);
  assert.deepEqual(resolvePlaceLabelRows(record,{ko:true,en:true,native:true},'1991-08-24').map(row=>row.text),['키이우','(현)Kyiv','(현)Київ']);
  assert.throws(()=>resolvePlaceLabelRows(record,{ko:true},'1991'));
});
test('missing timelines and dates before naming evidence show current-name prefixes without asserting absence',()=>{
  const record=place({name:'서울',nameEn:'Seoul',nameNative:'서울',nameTimeline:[]});
  const languages={ko:true,en:true,native:true};
  assert.deepEqual(resolvePlaceLabelRows(record,languages,'2012-06-30','2026-10-16').map(row=>row.text),['(현)서울','(현)Seoul']);
  assert.ok(resolvePlaceLabelRows(record,languages,'2012-06-30','2026-10-16').every(row=>row.modernName));
  assert.deepEqual(resolvePlaceLabelRows(record,languages,'2026-10-31','2026-10-16').map(row=>row.text),['서울','Seoul']);
  assert.deepEqual(resolvePlaceLabelRows(place(),{ko:true},'1700-01-01','2026-10-16').map(row=>row.text),['(현)키이우']);
});
test('identical English/native names deduplicate without duplicating the place object',()=>{
  const record=place({name:'부다페스트',nameEn:'Budapest',nameNative:'Budapest',nameTimeline:[]});
  const rows=resolvePlaceLabelRows(record,{ko:true,en:true,native:true});
  assert.deepEqual(rows.map(row=>row.text),['부다페스트','Budapest']);
  assert.equal(rows[1].language,'en');
});
test('three visible lines form one tall collision box',()=>{
  const rows=resolvePlaceLabelRows(place(),{ko:true,en:true,native:true});
  const multi=placeLabelDimensions(rows),single=placeLabelDimensions('키이우');
  assert.equal(multi.height,47);assert.ok(multi.width>=single.width);
  assert.deepEqual(layoutLabels([{key:'a',point:[100,100],...multi,priority:90,collisionGroup:'place'},
    {key:'b',point:[100,120],...single,priority:40,collisionGroup:'place'}]).map(item=>item.key),['a']);
});

test('map labels always keep Korean, never add English, and only offer native at 8x', () => {
  const record = place();
  assert.equal(PLACE_NATIVE_LABEL_MIN_ZOOM, 8);
  const labels = (zoom, showNativeNames) => mapPlaceLabelRowsAtMonth(record, '2099-12', { zoom, showNativeNames });
  assert.deepEqual(labels(8, false).rows.map(row => row.text), ['키이우']);
  assert.deepEqual(labels(8, false).secondaryRows, []);
  assert.deepEqual(labels(7.99, true).secondaryRows, []);
  assert.deepEqual(labels(8, true).rows.map(row => row.text), ['키이우']);
  assert.deepEqual(labels(8, true).secondaryRows.map(row => row.text), ['Київ']);
  assert.deepEqual(labels(32, true).secondaryRows.map(row => row.text), ['Київ']);
  assert.deepEqual(mapPlaceLabelRowsAtMonth(record, '-0044-03', { zoom: 32, showNativeNames: true }),
    { rows: [], secondaryRows: [] });
});

test('historical original name follows the project month and only one co-official form reaches the map', () => {
  const record = place({ name: '니코시아', nameNative: 'Λευκωσία',
    nameNativeExtras: ['Lefkoşa'], nameTimeline: [
      { fromYear: 1801, ko: '레프코샤', native: 'لفقوشه' },
      { fromDate: '1878-07-05', native: 'لفقوشه', nativeExtras: ['Nicosia', 'Λευκωσία'] },
      { fromDate: '1960-08-16', ko: '니코시아', native: 'Λευκωσία', nativeExtras: ['Lefkoşa'] },
    ] });
  const rows = month => mapPlaceLabelRowsAtMonth(record, month, { zoom: 8, showNativeNames: true });
  assert.deepEqual(rows('1878-06').secondaryRows.map(x => x.text), ['لفقوشه']);
  assert.deepEqual(rows('1960-09').secondaryRows.map(x => x.text), ['Λευκωσία']);
  assert.deepEqual(rows('1960-09').rows.map(x => x.text), ['니코시아']);
  assert.deepEqual(resolvePlaceLabelRows(record, { ko: true, en: true, native: true }, '1960-09-30')
    .map(x => x.text), ['니코시아', '(현)Kyiv', 'Λευκωσία', 'Lefkoşa']);
});

test('equal Korean and primary native names do not show the second co-official name instead', () => {
  const record = place({ name: '서울', nameNative: '서울', nameNativeExtras: ['Seoul'],
    nameTimeline: [] });
  const label = mapPlaceLabelRowsAtMonth(record, '2099-12', { zoom: 32, showNativeNames: true });
  assert.deepEqual(label.rows.map(row => row.text), ['서울']);
  assert.deepEqual(label.secondaryRows, []);
  const historicFallback = mapPlaceLabelRowsAtMonth(record, '1900-01', { zoom: 32, showNativeNames: true });
  assert.deepEqual(historicFallback.secondaryRows, [],
    'native duplicates must stay suppressed even when both names carry current-name markers');
});

test('native lines only expand into free space, never suppress an already placed Korean name', () => {
  const primaryRows = [{ language: 'ko', text: '서울' }];
  const native = [{ language: 'native', text: 'Seoul' }];
  const target = { key: 'seoul', point: [100, 100], priority: 90,
    rows: primaryRows, secondaryRows: native, collisionGroup: 'place',
    ...placeLabelDimensions(primaryRows) };
  const neighbor = { key: 'other', point: [100, 125], priority: 80,
    rows: [{ language: 'ko', text: '서울시' }], collisionGroup: 'place',
    ...placeLabelDimensions('서울시') };
  const crowded = layoutLabels([neighbor, target], { zoom: 8, padding: 3 });
  assert.deepEqual(crowded.map(row => row.key), ['seoul', 'other']);
  assert.deepEqual(crowded[0].rows.map(row => row.text), ['서울']);
  const free = layoutLabels([{ ...neighbor, point: [100, 200] }, target], { zoom: 8, padding: 3 });
  assert.deepEqual(free[0].rows.map(row => row.text), ['서울', 'Seoul']);
  assert.equal(free[0].height, 33);
});

test('year-only and exact naming dates retain distinct precision in the codec contract', () => {
  const record = place();
  assert.equal(record.nameTimeline[0].fromYear, 1801);
  assert.equal(record.nameTimeline[0].fromDate, undefined);
  assert.equal(record.nameTimeline[1].fromDate, '1991-08-24');
  assert.deepEqual(resolvePlaceLabelRows(record, { ko: true }, '1991-08-23').map(row => row.text), ['키예프']);
});

test('one canonical language switch rule is used by Web and native contract fixtures', () => {
  assert.deepEqual(normalizePlaceLanguages(null), { ko: true, en: false, native: false });
  assert.deepEqual(togglePlaceLanguage({ ko: true, en: false, native: false }, 'en', true), { ko: true, en: true, native: false });
  assert.equal(togglePlaceLanguage({ ko: false, en: true, native: false }, 'en', false), null);
  assert.throws(() => togglePlaceLanguage({ ko: true }, 'fr', true), TypeError);
});


test('multiple native forms deduplicate against English without losing remaining names', () => {
  const record = place({ name: '니코시아', nameEn: 'Nicosia', nameNative: 'Nicosia',
    nameNativeExtras: ['Λευκωσία', 'لفقوشه'], nameTimeline: [] });
  const languages = { ko: true, en: true, native: true };
  assert.deepEqual(resolvePlaceLabelRows(record, languages).map(row => row.text),
    ['니코시아', 'Nicosia', 'Λευκωσία', 'لفقوشه']);
  assert.deepEqual(resolvePlaceLabelRows(record, { ko: false, en: false, native: true }).map(row => row.text),
    ['Nicosia', 'Λευκωσία', 'لفقوشه']);
  const size = placeLabelDimensions(resolvePlaceLabelRows(record, languages));
  assert.equal(size.height, 61);
});

test('historical native extras replace, clear and restore without leaking across periods', () => {
  const record = place({ name: '니코시아', nameEn: 'Nicosia', nameNative: 'Λευκωσία',
    nameNativeExtras: ['Lefkoşa'], nameTimeline: [
      { fromYear: 1801, ko: '레프코샤', native: 'لفقوشه' },
      { fromDate: '1878-07-05', native: 'لفقوشه', nativeExtras: ['Nicosia', 'Λευκωσία'] },
      { fromDate: '1914-11-05', ko: '니코시아', native: 'Nicosia', nativeExtras: ['Λευκωσία', 'لفقوشه'] },
      { fromYear: 1930, native: 'Nicosia', nativeExtras: ['Λευκωσία', 'Lefkoşa'] },
      { fromDate: '1960-08-16', native: 'Λευκωσία', nativeExtras: ['Lefkoşa'] },
    ] });
  const all = { ko: true, en: true, native: true };
  const names = date => resolvePlaceLabelRows(record, all, date).map(row => row.text);
  assert.deepEqual(names('1878-07-04'), ['레프코샤', '(현)Nicosia', 'لفقوشه']);
  assert.deepEqual(names('1878-07-05'), ['레프코샤', '(현)Nicosia', 'لفقوشه', 'Λευκωσία']);
  assert.deepEqual(names('1914-11-05'), ['니코시아', '(현)Nicosia', 'Λευκωσία', 'لفقوشه']);
  assert.deepEqual(names('1930-05-01'), ['니코시아', '(현)Nicosia', 'Λευκωσία', 'Lefkoşa']);
  assert.deepEqual(names('1960-08-16'), ['니코시아', '(현)Nicosia', 'Λευκωσία', 'Lefkoşa']);
});

test('native variants reject invalid type, excess count and normalized duplicates', () => {
  for (const patch of [
    { nameNativeExtras: ['A', 'B', 'C'] },
    { nameNativeExtras: ['Київ', 'Київ'] },
    { nameNative: 'Budapest', nameNativeExtras: ['budapest'] },
    { nameNativeExtras: [27] },
    { nameNative: '', nameNativeExtras: ['Λευκωσία'] },
    { nameTimeline: [{ fromYear: 1801, nativeExtras: ['Λευκωσία'] }] },
    { nameTimeline: [{ fromYear: 1801, native: 'Nicosia', nativeExtras: ['Nicosia'] }] },
  ]) assert.throws(() => place(patch));
});
