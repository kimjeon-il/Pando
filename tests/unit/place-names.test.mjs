import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePlace, resolvePlaceLabelRows, normalizePlaceLanguages, togglePlaceLanguage } from '../../assets/js/modules/place-contract.js';
import { placeLabelDimensions, layoutLabels } from '../../assets/js/modules/label-layout.js';

const place = changes => normalizePlace({source:'geonames',sourceId:'703448',name:'키이우',nameEn:'Kyiv',nameNative:'Київ',
  kind:'capital',coordinates:[30.52,50.45],nameTimeline:[{fromYear:1801,ko:'키예프'},{fromDate:'1991-08-24',ko:'키이우'}],...changes});
test('Korean, English and native lines are independently selectable and ordered',()=>{
  const record=place();
  assert.deepEqual(resolvePlaceLabelRows(record,{ko:true,en:true,native:true}).map(row=>row.text),['키이우','Kyiv','Київ']);
  assert.deepEqual(resolvePlaceLabelRows(record,{ko:false,en:true,native:true}).map(row=>row.text),['Kyiv','Київ']);
  assert.deepEqual(resolvePlaceLabelRows(record,{ko:false,en:false,native:true}).map(row=>row.text),['Київ']);
  assert.deepEqual(resolvePlaceLabelRows(record,{ko:true,en:false,native:false}).map(row=>row.text),['키이우']);
});
test('per-language timeline does not silently change the English or native forms',()=>{
  const record=place();
  assert.deepEqual(resolvePlaceLabelRows(record,{ko:true,en:true,native:true},'1990-01-01').map(row=>row.text),['키예프','Kyiv','Київ']);
  assert.deepEqual(resolvePlaceLabelRows(record,{ko:true,en:true,native:true},'1991-08-24').map(row=>row.text),['키이우','Kyiv','Київ']);
  assert.throws(()=>resolvePlaceLabelRows(record,{ko:true},'1991'));
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
  assert.deepEqual(names('1878-07-04'), ['레프코샤', 'Nicosia', 'لفقوشه']);
  assert.deepEqual(names('1878-07-05'), ['레프코샤', 'Nicosia', 'لفقوشه', 'Λευκωσία']);
  assert.deepEqual(names('1914-11-05'), ['니코시아', 'Nicosia', 'Λευκωσία', 'لفقوشه']);
  assert.deepEqual(names('1930-05-01'), ['니코시아', 'Nicosia', 'Λευκωσία', 'Lefkoşa']);
  assert.deepEqual(names('1960-08-16'), ['니코시아', 'Nicosia', 'Λευκωσία', 'Lefkoşa']);
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
