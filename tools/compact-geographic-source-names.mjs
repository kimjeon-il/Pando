#!/usr/bin/env node
// Source-only name correction. Coordinate tokens and original-language fields
// are left byte-for-byte intact; generated map assets are rebuilt separately.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const names = new Map([
  ['PCN', '핏케언제도'], ['MHL', '마셜제도'], ['CYM', '케이맨제도'],
  ['ALD', '올란드제도'], ['FRO', '페로제도'], ['COK', '쿡제도'],
  ['SLB', '솔로몬제도'], ['FLK', '포클랜드제도'], ['MNP', '북마리아나제도'], ['CSI', '산호해제도'],
  ['TCA', '터크스케이커스제도'], ['UMI', '미국령군소제도'], ['HMD', '허드맥도널드제도'],
  ['SGS', '사우스조지아사우스샌드위치제도'], ['ATC', '애시모어카르티에제도'],
  ['SER', '세라니야환초'], ['BJN', '바호누에보환초'], ['SCR', '스카버러암초'],
  ['KAS', '시아첸빙하'], ['SPI', '남부파타고니아빙원'],
  ['BIH', '보스니아헤르체고비나'], ['SPM', '생피에르미클롱'], ['GNQ', '적도기니'],
  ['TTO', '트리니다드토바고'], ['VCT', '세인트빈센트그레나딘'], ['ATG', '앤티가바부다'],
  ['KNA', '세인트키츠네비스'], ['STP', '상투메프린시페'], ['WLF', '왈리스푸투나'],
  ['BRT', '비르타윌'], ['VIR', '미국령버진아일랜드'], ['VGB', '영국령버진아일랜드'],
  ['PYF', '프랑스령폴리네시아'], ['TUR', '튀르키예'], ['ESP', '에스파냐'],
]);

const canonicalPath = new URL('assets/data/countries-ne-5.1.1.geojson', root);
const original = fs.readFileSync(canonicalPath, 'utf8');
const collection = JSON.parse(original);
const replacements = new Map();
for (const [id, name] of names) {
  const feature = collection.features.find(feature => feature.id === id);
  assert.ok(feature, `missing country ${id}`);
  const previous = feature.properties.name;
  if (previous === name) continue;
  if (!['TUR', 'ESP'].includes(id)) assert.equal(previous.replace(/\s+/gu, ''), name, `unexpected source name ${id}`);
  else assert.equal(previous, id === 'TUR' ? '터키' : '스페인', `unexpected source name ${id}`);
  replacements.set(previous, name);
}
const canonical = original.replace(/"name":(\s*)("(?:\\.|[^"\\])*")/gu, (match, gap, quoted) => {
  const name = replacements.get(JSON.parse(quoted));
  return name ? `"name":${gap}${JSON.stringify(name)}` : match;
});
const next = JSON.parse(canonical);
assert.deepEqual(next.features.map(feature => feature.geometry), collection.features.map(feature => feature.geometry));
assert.deepEqual(next.features.map(feature => feature.id), collection.features.map(feature => feature.id));
for (const [id, name] of names) assert.equal(next.features.find(feature => feature.id === id).properties.name, name);
if (canonical !== original) fs.writeFileSync(canonicalPath, canonical);
fs.writeFileSync(new URL('assets/data/countries-ne-5.1.1.geojson.gz', root), gzipSync(Buffer.from(canonical), { level: 9, mtime: 0 }));

const hydroChanges = {};
for (const filename of ['rivers_base.geojson', 'lakes_base.geojson', 'hydronym-ko-overrides.json']) {
  const path = new URL(`assets/data/hydro/${filename}`, root);
  const source = fs.readFileSync(path, 'utf8');
  let count = 0;
  const output = source.replace(/"(name|name_ko|nameKo)":(\s*)("(?:\\.|[^"\\])*")/gu, (match, key, gap, quoted) => {
    const name = JSON.parse(quoted);
    if (!/[가-힣]/.test(name) || name.startsWith('미명명')) return match;
    const compact = name.replace(/\s+/gu, '');
    if (compact === name) return match;
    count += 1;
    return `"${key}":${gap}${JSON.stringify(compact)}`;
  });
  if (output !== source) fs.writeFileSync(path, output);
  hydroChanges[filename] = count;
}
console.log(JSON.stringify({ countryNamesChanged: replacements.size, hydroNameFieldsChanged: hydroChanges }));
