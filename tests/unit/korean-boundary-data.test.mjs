import {repositoryFrontendUrl} from '../helpers/frontend-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {normalizeTerritorialLibraryEntity,selectGeometryVersion} from "../../apps/editor/frontend/js/modules/territorial-library.js";
import {createRingHitTester} from "../../shared/frontend/js/modules/ring-hit-test.js";
import {clippingOperationWithPrecisionRetry} from "../../apps/editor/frontend/js/modules/polygon-clipping-calculation.js";
import {builtinProject} from '../helpers/builtin-world.mjs';
import {createGeometryVersionStore} from "../../shared/frontend/js/modules/geometry-version-store.js";
import {resolveWorld} from "../../shared/frontend/js/modules/timeline-resolver.js";
import {refineChinesePaektuSource} from '../../tools/build-korean-boundaries.mjs';

const readCountry=id=>normalizeTerritorialLibraryEntity(JSON.parse(fs.readFileSync(repositoryFrontendUrl(`assets/data/territorial-entities/source/countries/state-${id}.json`))));
const korea=readCountry('KOR'),north=readCountry('PRK');
const rings=createRingHitTester(ring=>ring);
const contains=(entity,date,point)=>{
  const geometry=selectGeometryVersion(entity,date).geometry;
  return (geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates).some(p=>
    rings.contains(point,p[0])&&!p.slice(1).some(hole=>rings.contains(point,hole)));
};

test('Korean identities start on their respective government establishment days',()=>{
  assert.deepEqual(korea.lifetime,{validFrom:'1948-08-15',validTo:null});
  assert.deepEqual(north.lifetime,{validFrom:'1948-09-09',validTo:null});
  assert.equal(selectGeometryVersion(korea,'1948-08-14'),null);
  assert.equal(selectGeometryVersion(north,'1948-09-08'),null);
  assert.ok(selectGeometryVersion(korea,'1948-08-15'));
  assert.ok(selectGeometryVersion(north,'1948-09-09'));
});

test('armistice changes the Korean mutual boundary on the exact day without wartime versions',()=>{
  for(const entity of [korea,north]){
    const before=selectGeometryVersion(entity,'1953-07-26');
    const after=selectGeometryVersion(entity,'1953-07-27');
    assert.notEqual(before.versionId,after.versionId);
    assert.equal(before.validTo,'1953-07-26');
    assert.equal(after.validFrom,'1953-07-27');
    assert.equal(selectGeometryVersion(entity,'1950-06-25').versionId,before.versionId);
    assert.equal(selectGeometryVersion(entity,'1951-01-04').versionId,before.versionId);
  }
});

test('Sino-Korean settlement is distinguished from treaty signature and changes on protocol effectiveness',()=>{
  const before=selectGeometryVersion(north,'1964-03-19');
  const after=selectGeometryVersion(north,'1964-03-20');
  assert.notEqual(before.versionId,after.versionId);
  assert.equal(selectGeometryVersion(north,'1962-10-12').versionId,before.versionId);
  assert.equal(before.validTo,'1964-03-19');
  assert.equal(after.validFrom,'1964-03-20');
  assert.deepEqual(before.geometry,after.geometry,'Do not invent a pre-settlement transfer mask without period geometry');
  assert.match(before.historicalProvenance.unresolvedSegments.join(' '),/pre-settlement/);
  assert.equal(after.historicalProvenance.protocolEffective,'1964-03-20');
  assert.equal(after.historicalProvenance.independentPeriodScreenDeltaChecked,false);
  assert.match(before.historicalProvenance.notice,/북쪽 경계.*미복원/);
  assert.match(after.historicalProvenance.notice,/영토 차이.*미복원/);
  assert.deepEqual(korea.geometryVersions.flatMap(v=>v.historicalProvenance.unresolvedSegments),[]);
});

test('the 38th parallel/MDL transition changes actual settlement attribution',()=>{
  for(const point of [[126.554,37.971],[125.35,37.94]]){
    assert.equal(contains(korea,'1953-07-26',point),true);
    assert.equal(contains(north,'1953-07-26',point),false);
    assert.equal(contains(korea,'1953-07-27',point),false);
    assert.equal(contains(north,'1953-07-27',point),true);
  }
  for(const point of [[128.59,38.2],[127.31,38.14]]){
    assert.equal(contains(korea,'1953-07-26',point),false);
    assert.equal(contains(north,'1953-07-26',point),true);
    assert.equal(contains(korea,'1953-07-27',point),true);
    assert.equal(contains(north,'1953-07-27',point),false);
  }
});

test('Baengnyeong island keeps its whole South Korean component across armistice',()=>{
  const point=[124.67,37.96];
  assert.equal(contains(korea,'1953-07-26',point),true);
  assert.equal(contains(korea,'1953-07-27',point),true);
  const components=geometry=>geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  const before=components(selectGeometryVersion(korea,'1953-07-26').geometry).find(p=>rings.contains(point,p[0]));
  const after=components(selectGeometryVersion(korea,'1953-07-27').geometry).find(p=>rings.contains(point,p[0]));
  assert.deepEqual(before,after);
});

test('the paired Korean/Chinese changes preserve the Korean land union and produce no ownership overlap',()=>{
  const original=JSON.parse(fs.readFileSync(new URL('../../assets/data/countries-ne-5.1.1.geojson',import.meta.url)));
  const china=readCountry('CHN');
  const coordinates=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
  const before=original.features.filter(f=>['KOR','PRK','CHN'].includes(f.id)).map(f=>coordinates(f.geometry));
  const current=[korea,north,china].map(e=>coordinates(selectGeometryVersion(e,'2026-10-06').geometry));
  const union=values=>clippingOperationWithPrecisionRetry('union',...values);
  // China's other land borders are independently supplemented. Restrict the
  // original NE union comparison to Korea and its Chinese counterpart region.
  const region=[[[[123,36],[130,36],[130,42.8],[123,42.8],[123,36]]]];
  const within=values=>clippingOperationWithPrecisionRetry('intersection',union(values),region);
  assert.deepEqual(clippingOperationWithPrecisionRetry('xor',within(before),within(current)),[]);
  assert.deepEqual(clippingOperationWithPrecisionRetry('intersection',current[0],current[1]),[]);
  assert.deepEqual(clippingOperationWithPrecisionRetry('intersection',current[1],current[2]),[]);
  assert.equal(china.geometryVersions.length,1,'A local counterpart correction must not invent Chinese historical coverage');
  assert.equal(Object.hasOwn(china.geometryVersions[0],'datePrecision'),false);
  assert.equal(contains(north,'1964-03-20',[128.045,42.016]),false,'northwest Cheonji belongs to China');
  assert.equal(contains(china,'2026-10-06',[128.045,42.016]),true);
  assert.equal(contains(north,'1964-03-20',[128.07,42.006]),true,'southeast Cheonji belongs to North Korea');
  assert.equal(contains(china,'2026-10-06',[128.07,42.006]),false);
});

test('Korean reconstruction preserves the supplemented Chinese counterpart byte for byte',()=>{
  const china=readCountry('CHN');
  const lines=JSON.parse(fs.readFileSync(new URL('../../tools/historical-library/sources/korea/lsib-11.4-korean-boundaries.geojson',import.meta.url)));
  assert.ok(china.geometryVersions[0].modernBoundarySupplement);
  assert.deepEqual(refineChinesePaektuSource(china,lines,'unused-on-unchanged-chain',china.metadata.representativeGeometryVersionId),china);
});

test('the actual published timeline retains Korean creation dates and the June/July 1953 geometry change',()=>{
  const view=month=>{const project=builtinProject(month);return resolveWorld(project.territorialEntities,project.timelineRecords,createGeometryVersionStore(project.geometries),month).entities;};
  assert.equal(view('1948-07').some(e=>e.id==='KOR'||e.id==='PRK'),false);
  assert.equal(view('1948-08').some(e=>e.id==='KOR'),true);
  assert.equal(view('1948-08').some(e=>e.id==='PRK'),false);
  assert.equal(view('1948-09').some(e=>e.id==='PRK'),true);
  const before=view('1953-06'),after=view('1953-07');
  const owns=(rows,id,point)=>{
    const g=rows.find(e=>e.id===id).geometry;
    return (g.type==='Polygon'?[g.coordinates]:g.coordinates).some(p=>rings.contains(point,p[0])&&!p.slice(1).some(h=>rings.contains(point,h)));
  };
  assert.equal(owns(before,'KOR',[126.554,37.971]),true);
  assert.equal(owns(after,'PRK',[126.554,37.971]),true);
  assert.equal(owns(before,'PRK',[128.59,38.2]),true);
  assert.equal(owns(after,'KOR',[128.59,38.2]),true);
  assert.ok(view('2026-11').some(e=>e.id==='KOR'));
});
