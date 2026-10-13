/**
 * Guarded one-time Indonesia territorial reconstruction with West New Guinea
 * and East Timor. Updates existing country-source entities, never creates an
 * Indonesian country identity or modifies the present canonical coordinates.
 *
 * Source geography: original Natural Earth 5.1.1 country component polygons,
 * 25 Papuan components pinned via same-version Admin-1 province intersection.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const originalCommit='1519f609bd69f7e57dbdfdcec4e8036366bbd12f';
assert.equal(execFileSync('git',['merge-base',originalCommit,'HEAD'],{cwd:root,encoding:'utf8'}).trim(),originalCommit);
const pathOf=rel=>path.join(root,rel);
const load=rel=>JSON.parse(fs.readFileSync(pathOf(rel),'utf8'));
const save=(rel,value)=>fs.writeFileSync(pathOf(rel),JSON.stringify(value,null,2)+'\n');
const idnPath='assets/data/territorial-entities/source/countries/indonesia.json';
const tlsPath='assets/data/territorial-entities/source/countries/tls.json';
const mask=load('tools/historical-library/sources/indonesia/west-new-guinea-component-mask-v5.1.1.json');
const idnSource=load(idnPath),tlsSource=load(tlsPath);
const idn=idnSource.entities.find(x=>x.entityId==='state:IDN');
const tls=tlsSource.entities.find(x=>x.entityId==='state:TLS');
assert.ok(idn&&tls);
assert.equal(idn.geometryVersions.length,2,'Expected last approved IDN layout');
assert.equal(tls.geometryVersions.length,1,'Expected undated TLS layout');
assert.deepEqual(idn.lifetime,{validFrom:'1945-08-17',validTo:null});
assert.deepEqual(tls.lifetime,{validFrom:null,validTo:null});
const [occupation,modern]=idn.geometryVersions;
const timorModern=tls.geometryVersions[0];
assert.equal(occupation.versionId,'state:indonesia:1945-2002-r1');
assert.equal(occupation.validFrom,'1945-08-17');
assert.equal(occupation.validTo,'2002-05-19');
assert.equal(occupation.instantiation.mode,'territory-replacement');
assert.equal(modern.versionId,'state:IDN:natural-earth-5.1.1');
assert.equal(modern.validFrom,'2026-10-06');
assert.equal(modern.validTo,null);
assert.equal(timorModern.versionId,'state:TLS:natural-earth-5.1.1');
assert.equal(timorModern.validFrom,null);
assert.equal(timorModern.validTo,null);
assert.equal(idn.sourceInfo.geometrySha256,mask.canonical.sourceGeometrySha256);
assert.equal(mask.canonical.entityId,idn.entityId);
assert.equal(mask.canonical.geometryVersionId,modern.versionId);
assert.equal(modern.geometry.type,'MultiPolygon');
assert.equal(modern.geometry.coordinates.length,264);
assert.equal(mask.canonical.totalPolygonComponents,264);
const excluded=mask.excludedModernPolygonIndices;
assert.equal(excluded.length,25);
assert.equal(new Set(excluded).size,excluded.length);
assert.ok(excluded.includes(3),'Papua mainland must be excluded');
assert.ok(excluded.every(i=>Number.isInteger(i)&&i>=0&&i<264));
assert.equal(occupation.geometry.type,'MultiPolygon');
assert.equal(occupation.geometry.coordinates.length,265,'Expected original current-IDN-plus-Timor union');

const ref='2026-10-06';
const sourceCommon={
 physicalBoundarySource:'Natural Earth 5.1.1 present-day canonical geometry',
 sourceReferenceDate:ref,
 verifiedHistoricalGeometry:false,
 provinceMaskSource:mask.source.url,
 politicalTerritoryBasis:'effective-administration or de-facto proxy, not legal title',
};
function proxy(v,{id,start,end,notes,sourceId,provenance={}}){
 const row=structuredClone(v);
 Object.assign(row,{versionId:id,validFrom:start,validTo:end,
    datePrecision:'approximate',certainty:'low',sourceId,
    notes,instantiation:{mode:'territory-replacement',countryUpdates:{}},
    historicalProvenance:{...sourceCommon,...provenance}});
 return row;
}
const mainlandBefore={
  type:'MultiPolygon',
  coordinates:modern.geometry.coordinates.filter((_,i)=>!excluded.includes(i))
};
assert.equal(mainlandBefore.coordinates.length,239);
assert.equal(modern.geometry.coordinates.length-mainlandBefore.coordinates.length,25);
const prePapua=proxy(modern,{
 id:'state:IDN:1945-1963-before-west-new-guinea-r1',
 start:'1945-08-17',end:'1963-04-30',
 sourceId:'natural-earth-5.1.1-admin1-papua-island-mask',
 notes:'1945~1963년 서뉴기니 행정권 이전 전. 현행 인도네시아 264개 폴리곤 가운데 같은 Natural Earth 5.1.1 파푸아·서파푸아 행정구역과 일치하는 25개 섬 구성요소를 제외한 근사 형상. 1945~1949 독립전쟁 기간의 실제 통제경계까지 복원한 자료는 아님.',
 provenance:{
  eventDate:'1963-05-01',
  event:'West New Guinea administrative transfer UNTEA to Indonesia',
  maskSelectedComponents:excluded,
  evidence:['https://peacekeeping.un.org/sites/default/files/past/unsfbackgr.html'],
 }});
prePapua.geometry=mainlandBefore;
const afterPapua=proxy(modern,{
 id:'state:IDN:1963-1975-before-east-timor-r1',
 start:'1963-05-01',end:'1975-12-06',
 sourceId:'natural-earth-5.1.1-post-west-new-guinea-temporal-proxy',
 notes:'1963년 5월 1일 유엔 임시행정부의 서뉴기니 행정권 이전 후. 2026년 현재 인도네시아 정식 국경을 1963~1975년의 근사 형상으로 재사용하므로 당대 세부 경계 검증 자료는 아님.',
 provenance:{
  eventDate:'1963-05-01',
  event:'West New Guinea transfer of administration',
  evidence:['https://peacekeeping.un.org/sites/default/files/past/unsfbackgr.html'],
 }});
const occupationProxy=structuredClone(occupation);
occupationProxy.historicalProvenance={
 ...structuredClone(occupation.historicalProvenance||{}),
 originalGeometryVersionId:occupation.versionId,
 originalInterval:{validFrom:occupation.validFrom,validTo:occupation.validTo},
 correctedIntervalReason:'Existing union erroneously assigned East Timor throughout 1945-2002; now scoped to 1975 military occupation through 1999 UN transition.',
 eventDates:{begin:'1975-12-07',end:'1999-10-25'},
 evidence:['https://peacekeeping.un.org/sites/default/files/past/etimor/Untaetchrono.html','https://peacekeeping.un.org/sites/default/files/past/unmiset/background.html'],
 verifiedHistoricalGeometry:false,
};
occupationProxy.validFrom='1975-12-07';
occupationProxy.validTo='1999-10-24';
occupationProxy.datePrecision='approximate';
occupationProxy.certainty='low';
occupationProxy.notes='동티모르 점령기 실효 지배 범위의 근사 형상. 1975-12-07 침공 개시일부터 동티모르 전체를 한 번에 포함하는 월별 단순화이며, 당시 모든 지역의 점령 완료 또는 합법적인 병합을 뜻하지 않는다. 1976년 정식 편입 주장은 유엔이 인정하지 않았다. 1999-10-25 유엔 과도행정부 출범과 함께 제외.';
const afterTimor=proxy(modern,{
 id:'state:IDN:1999-2026-after-east-timor-r1',
 start:'1999-10-25',end:'2026-10-05',
 sourceId:'natural-earth-5.1.1-post-east-timor-temporal-proxy',
 notes:'1999-10-25 UNTAET 설치 이후 동티모르 제외. 현대 Natural Earth 인도네시아 폴리곤을 1999~2026년 기간에 재사용한 잠정 형상으로, 이후의 세부 경계 변화 미검증.',
 provenance:{
  eventDate:'1999-10-25',
  event:'United Nations Transitional Administration in East Timor established',
  evidence:['https://peacekeeping.un.org/sites/default/files/past/etimor/etimor.htm'],
 }});
idn.geometryVersions=[prePapua,afterPapua,occupationProxy,afterTimor,modern];

tls.lifetime.validFrom='2002-05-20';
tls.lifetime.validTo=null;
const tlsProxy=proxy(timorModern,{
 id:'state:TLS:2002-2026-independence-r1',
 start:'2002-05-20',end:'2026-10-05',
 sourceId:'natural-earth-5.1.1-east-timor-independence-proxy',
 notes:'2002-05-20 동티모르 독립 이후 현대 Natural Earth 국경을 임시 적용한 형상. 1999-10-25~2002-05-19 UNTAET 통치기는 독립국 존속기간에 자동 포함하지 않으며 별도의 통치 객체가 필요함.',
 provenance:{
  eventDate:'2002-05-20',
  event:'Timor-Leste independence',
  evidence:['https://peacekeeping.un.org/sites/default/files/past/etimor/etimor.htm'],
 }});
timorModern.validFrom=ref;
timorModern.validTo=null;
tls.geometryVersions=[tlsProxy,timorModern];

assert.deepEqual(idn.geometryVersions.map(x=>[x.validFrom,x.validTo]),[
 ['1945-08-17','1963-04-30'],['1963-05-01','1975-12-06'],['1975-12-07','1999-10-24'],['1999-10-25','2026-10-05'],['2026-10-06',null]
]);
assert.deepEqual(tls.geometryVersions.map(x=>[x.validFrom,x.validTo]),[
 ['2002-05-20','2026-10-05'],['2026-10-06',null]
]);
save(idnPath,idnSource);save(tlsPath,tlsSource);

const bld='tools/build-historical-world-timeline.mjs';
const bsrc=fs.readFileSync(pathOf(bld),'utf8');
const before="'1900-01', '1941-04', '1945-11', '1991-08'";
const after="'1900-01', '1941-04', '1945-11', '1963-04', '1963-05', '1975-11', '1975-12', '1999-09', '1999-10', '2002-04', '2002-05', '1991-08'";
assert.equal(bsrc.split(before).length,2,'Expected exactly one fixed trace month anchor');
fs.writeFileSync(pathOf(bld),bsrc.replace(before,after));
console.log('Indonesia five dated versions, Timor-Leste two dated versions; removed 25 verified West New Guinea components in pre-1963 polygon only');
