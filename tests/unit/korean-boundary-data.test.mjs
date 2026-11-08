import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {normalizeTerritorialLibraryEntity,selectGeometryVersion} from "../../tools/gis/territorial-library.js";
import {createRingHitTester} from "../../src/geometry/ring-hit-test.js";
import {clippingOperationWithPrecisionRetry} from "../../tools/gis/polygon-clipping-calculation.js";
import {scopedBuiltinProject} from '../helpers/builtin-world.mjs';
import {createGeometryVersionStore} from "../../src/geometry/geometry-version-store.js";
import {resolveWorld} from "../../src/document/timeline-resolver.js";
import {restoreChinesePaektuSource,readBoundaryChain,buildKoreanBoundaryGeometry} from '../../tools/build-korean-boundaries.mjs';

const readCountry=id=>normalizeTerritorialLibraryEntity(JSON.parse(fs.readFileSync(new URL(`../../assets/data/territorial-entities/source/countries/state-${id}.json`,import.meta.url))));
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
  const start=[128.14425,41.754713],end=[128.597556,42.027126],witness=[128.054643,41.998316];
  const expected=readBoundaryChain(original.features.find(f=>f.id==='PRK').geometry,start,end,witness);
  assert.deepEqual(readBoundaryChain(selectGeometryVersion(north,'1964-03-20').geometry,start,end,witness),expected);
  assert.deepEqual(readBoundaryChain(selectGeometryVersion(china,'2026-10-06').geometry,start,end,witness),expected);
  for(const point of [[128.045,42.016],[128.07,42.006]])for(const [id,entity]of [['PRK',north],['CHN',china]]){
    const g=original.features.find(f=>f.id===id).geometry;
    const expectedOwner=coordinates(g).some(p=>rings.contains(point,p[0])&&!p.slice(1).some(h=>rings.contains(point,h)));
    assert.equal(contains(entity,'2026-10-06',point),expectedOwner,'Display attribution follows the pre-LSIB NE baseline, not a newly claimed treaty reconstruction');
  }
});

test('Korean baseline generation keeps the Chinese counterpart idempotent and does not reinsert LSIB',()=>{
  const china=readCountry('CHN'),lines=JSON.parse(fs.readFileSync(new URL('../../tools/historical-library/sources/korea/lsib-11.4-korean-boundaries.geojson',import.meta.url)));
  const original=JSON.parse(fs.readFileSync(new URL('../../assets/data/countries-ne-5.1.1.geojson',import.meta.url))),version=china.geometryVersions.find(v=>v.versionId===china.metadata.representativeGeometryVersionId);
  assert.equal(version.sourceId.split('+').includes('dos-lsib-11.4'),false);
  assert.ok(version.historicalProvenance.retiredModernSourceIds.includes('dos-lsib-11.4'));
  const before=JSON.stringify(china),restored=restoreChinesePaektuSource(china,original,lines,version.versionId);
  assert.deepEqual(restored,china);assert.equal(JSON.stringify(china),before);
  const rebuilt=buildKoreanBoundaryGeometry(original),start=[128.14425,41.754713],end=[128.597556,42.027126],witness=[128.054643,41.998316];
  assert.deepEqual(readBoundaryChain(rebuilt.northMdl,start,end,witness),readBoundaryChain(rebuilt.china,start,end,witness));
});

test('the actual published timeline retains Korean creation dates and the June/July 1953 geometry change',async()=>{
  const view=async month=>{const project=await scopedBuiltinProject(month,['KOR','PRK','CHN']);return resolveWorld(project.territorialEntities,project.timelineRecords,createGeometryVersionStore(project.geometries),month).entities;};
  assert.equal((await view('1948-07')).some(e=>e.id==='KOR'||e.id==='PRK'),false);
  assert.equal((await view('1948-08')).some(e=>e.id==='KOR'),true);
  assert.equal((await view('1948-08')).some(e=>e.id==='PRK'),false);
  assert.equal((await view('1948-09')).some(e=>e.id==='PRK'),true);
  const before=await view('1953-06'),after=await view('1953-07');
  const owns=(rows,id,point)=>{
    const g=rows.find(e=>e.id===id).geometry;
    return (g.type==='Polygon'?[g.coordinates]:g.coordinates).some(p=>rings.contains(point,p[0])&&!p.slice(1).some(h=>rings.contains(point,h)));
  };
  assert.equal(owns(before,'KOR',[126.554,37.971]),true);
  assert.equal(owns(after,'PRK',[126.554,37.971]),true);
  assert.equal(owns(before,'PRK',[128.59,38.2]),true);
  assert.equal(owns(after,'KOR',[128.59,38.2]),true);
  assert.ok((await view('2026-11')).some(e=>e.id==='KOR'));
});
