/**
 * One-time guarded historical-boundary coverage repair.
 * Reuses existing Natural Earth coordinates as low-confidence temporal proxies.
 * Must run in the pre-validated work/objects branch.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const sourceDate='2026-10-06';
const lastProxyDay='2026-10-05';
const baseline='f1f9a53b1535024c9a3c207a127f2e8393619bf8';
const source=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const update=(relative,value)=>fs.writeFileSync(path.join(root,relative),value);
const read=relative=>JSON.parse(source(relative));
const save=(relative,data)=>update(relative,JSON.stringify(data,null,2)+'\n');
function patch(relative,from,to){
 const input=source(relative);
 assert.equal(input.split(from).length,2,'Exactly one patch anchor expected: '+relative);
 update(relative,input.replace(from,to));
}
assert.equal(execFileSync('git',['merge-base',baseline,'HEAD'],{cwd:root,encoding:'utf8'}).trim(),baseline,
 'work/objects must contain the previously verified identity consolidation');
function extend(lineage,id,currentId,postId,eventDay,notes,citations,expectedOldEnd=null){
 const file='assets/data/territorial-entities/source/countries/'+lineage+'.json';
 const data=read(file);
 const e=data.entities.find(row=>row.entityId===id);
 assert.ok(e,'Missing original entity '+id);
 assert.equal(e.geometryVersions.length,expectedOldEnd===null?1:2,'Unexpected version count for '+id);
 assert.equal(e.geometryVersions.at(-1).versionId,currentId);
 if(expectedOldEnd!==null)assert.equal(e.geometryVersions[0].validTo,expectedOldEnd);
 assert.equal(e.geometryVersions.at(-1).validTo,null);
 assert.equal(e.lifetime.validTo,null);
 const modern=e.geometryVersions.at(-1);
 assert.ok(modern.geometry?.coordinates?.length,'Modern geometry absent for '+id);
 if(modern.validFrom!==null)assert.equal(modern.validFrom,sourceDate);
 const interim=structuredClone(modern);
 interim.versionId=postId;
 interim.validFrom=eventDay;
 interim.validTo=lastProxyDay;
 interim.datePrecision='approximate';
 interim.certainty='low';
 interim.sourceId='natural-earth-5.1.1-current-outline-temporal-proxy';
 interim.notes=notes;
 interim.instantiation={mode:'territory-replacement',countryUpdates:{}};
 interim.historicalProvenance={
  classification:'provisional-modern-outline-proxy',
  sourceReferenceDate:sourceDate,
  politicalEventDate:eventDay,
  originalGeometryVersionId:currentId,
  evidence:citations,
  verifiedHistoricalGeometry:false
 };
 modern.validFrom=sourceDate;
 modern.validTo=null;
 e.geometryVersions.splice(e.geometryVersions.length-1,0,interim);
 assert.equal(e.geometryVersions.length,expectedOldEnd===null?2:3);
 assert.deepEqual(interim.geometry,modern.geometry);
 save(file,data);
 return {id,postId,eventDay,versionCount:e.geometryVersions.length};
}
const created=[
 extend(
  'sudan','state:SDN','state:SDN:natural-earth-5.1.1','state:SDN:2011-07-09-post-secession-r1','2011-07-09',
  '2011-07-09 남수단 독립 뒤 수단 형상 잠정값. 2026-10-06 Natural Earth 외곽선을 2011~2026 구간의 대리 자료로 사용. 아비에이(Abyei) 분쟁지역과 경계 변경을 해당 연도별로 검증한 도형이 아님.',
  ['https://www.un.org/en/node/122910','https://unmis.unmissions.org/en/unmis-0/more-borderline'],
  '2011-07-08'),
 extend(
  'sds','state:SDS','state:SDS:natural-earth-5.1.1','state:SDS:2011-07-09-independence-r1','2011-07-09',
  '2011-07-09 독립한 남수단. 현대 Natural Earth 외곽선을 초기 독립국의 잠정 경계로 재사용. 아비에이·미획정 경계의 당대 확정 형상은 아님.',
  ['https://www.un.org/en/node/122910','https://www.unmissions.org/en/unmis-0/security-council-establishes-abyei-mission']),
 extend(
  'ukraine','state:UKR','state:UKR:natural-earth-5.1.1','state:UKR:2014-03-18-post-crimea-r1','2014-03-18',
  '2014-03-18 러시아의 크림반도 병합 조약을 실효 지배 지도상 전환 시점으로 채택. 우크라이나의 크림 제외 영역을 2026-10-06 Natural Earth 외곽선으로 근사. 국제법상 크림 영유권 변화를 승인한 의미가 아니며 동부 전쟁과 2022년 이후 실제 통제선·분쟁지역 경계의 연도별 검증을 뜻하지 않음.',
  ['https://hudoc.echr.coe.int/?i=002-14347','https://press.un.org/en/2014/ga11493.doc.htm','https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/'],
  '2014-03-17')
];
assert.deepEqual(created.map(e=>e.versionCount),[3,2,3]);
patch('tools/build-historical-world-timeline.mjs',
 "'1991-12', '2012-10', '2014-02', '2014-03'",
 "'1991-12', '2011-06', '2011-07', '2012-10', '2014-02', '2014-03'");
patch('native/tests/historical_world_timeline_tests.cpp',
 '"1991-12","2012-09"',
 '"1991-12","2011-06","2011-07","2012-09"');
console.log(JSON.stringify({created,referenceDate:sourceDate,missingBoundaryPrecision:'low'}));
