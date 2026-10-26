import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {
 assetDigest,sourceGeometry,oneHistoricalWater,verifyPublishedPhysicalManifest,
 deterministicGzipJSON,createPhysicalCandidates,stagePhysicalCandidates,
 validatePhysicalResult,SOURCE,
} from '../../tools/gis/replay-ussr-1922-physical.mjs';

const current={type:'MultiPolygon',coordinates:[
 [[[45,35],[46,35],[46,36],[45,35]]],
]};
const water={type:'Polygon',coordinates:[
 [[49,40],[53,40],[53,44],[49,40]],
]};
const source=()=>({
  'caspian-1922-land.json.gz':deterministicGzipJSON(current).compressed,
  'caspian-1922-water.json.gz':deterministicGzipJSON(water).compressed,
});
const manifest=assets=>({
  historicalWaterbodies:[{
    id:'caspian-near1922-approved',
    validFrom:'1922-12-30',validTo:'1925-05-12',
    referenceDate:'1922-12-30',
    scope:'Physical water presentation only, not a sovereignty subtraction',
    land:{url:SOURCE+'caspian-1922-land.json.gz',
      ...assetDigest(assets['caspian-1922-land.json.gz'])},
    water:{url:SOURCE+'caspian-1922-water.json.gz',
      ...assetDigest(assets['caspian-1922-water.json.gz'])},
  }],
});
test('original publication manifest retains both compressed source-byte receipts and legal periods',()=>{
 const assets=source(),m=manifest(assets);
 assert.equal(verifyPublishedPhysicalManifest(m,assets).id,'caspian-near1922-approved');
 const copy=structuredClone(m);copy.historicalWaterbodies[0].water.sha256='0'.repeat(64);
 assert.throws(()=>verifyPublishedPhysicalManifest(copy,assets),/digest differs/);
 const wrong=structuredClone(m);wrong.historicalWaterbodies[0].validFrom='1900-01-01';
 assert.throws(()=>verifyPublishedPhysicalManifest(wrong,assets),/validity/);
});
test('Node source adaptor unwraps original feature without inventing a second geometry',()=>{
 const feature={type:'Feature',geometry:water,properties:{source:'provisional'}};
 assert.deepEqual(sourceGeometry({type:'FeatureCollection',features:[feature]}),water);
 assert.deepEqual(oneHistoricalWater({type:'MultiPolygon',
   coordinates:[water.coordinates]}),water);
 assert.throws(()=>oneHistoricalWater({type:'MultiPolygon',coordinates:[
   water.coordinates,water.coordinates,
 ]}),/one water polygon/);
});
test('staged gzip/manifest are reproducible and do not overwrite approved originals',t=>{
 const assets=source(),m=manifest(assets);
 const candidate=createPhysicalCandidates({land:current,water},m);
 assert.equal(candidate.size,3);
 const archive=candidate.get(SOURCE+'caspian-1922-water.json.gz');
 assert.equal(archive[9],10);
 assert.deepEqual(JSON.parse(gunzipSync(archive)),water);
 const manifestCandidate=JSON.parse(candidate.get(SOURCE+'manifest.json'));
 assert.equal(manifestCandidate.historicalWaterbodies[0].water.sha256,
   assetDigest(archive).sha256);
 const dir=mkdtempSync(join(tmpdir(),'caspian-stage-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const destination=join(dir,'proposed');
 stagePhysicalCandidates(candidate,destination);
 assert.deepEqual(readFileSync(join(destination,SOURCE+'caspian-1922-water.json.gz')),
   archive);
 assert.throws(()=>stagePhysicalCandidates(candidate,destination),/must be new/);
 assert.deepEqual(m,manifest(assets),'Existing manifest must remain unchanged');
});
test('physical staging rejects root, sibling-prefix and absolute escape paths',t=>{
 const dir=mkdtempSync(join(tmpdir(),'caspian-stage-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const outside=join(dir,'outside.json');
 for(const [i,path] of ['.','../outside.json','../proposed-peer/outside.json',outside].entries()){
   assert.throws(()=>stagePhysicalCandidates(new Map([[path,Buffer.from('must not write')]]),join(dir,'proposed-'+i)),/escapes staging root/);
 }
 assert.equal(existsSync(outside),false);
 assert.equal(existsSync(join(dir,'proposed-peer/outside.json')),false);
});

test('native proof must show zero sovereign displacement and the exact 68 Caspian holes',()=>{
 const proof={land:current,metrics:{
   historicalWaterHoles:68,unchangedFarPolygonCount:200,
   unchangedFarGeometryPreserved:true,
   outsideRegionDifferenceSquareDegrees:0,
   publishedSymmetricDifferenceSquareDegrees:0,
   modernWaterAreaKm2:429000,historicalWaterAreaKm2:431000,
   fullLandValid:true,patchedLandValid:true,localLandValid:true,
   modernFullLandValid:true,
 }};
 assert.equal(validatePhysicalResult(proof).unchangedFarPolygonCount,200);
 proof.metrics.modernFullLandValid=false;
 proof.metrics.fullLandValid=false;
 proof.metrics.preexistingGlobalInvalidityPreserved=true;
 assert.equal(validatePhysicalResult(proof).preexistingGlobalInvalidityPreserved,true);
 proof.metrics.preexistingGlobalInvalidityPreserved=false;
 assert.throws(()=>validatePhysicalResult(proof),/differs/);
 proof.metrics.fullLandValid=true;
 proof.metrics.publishedSymmetricDifferenceSquareDegrees=0.1;
 assert.throws(()=>validatePhysicalResult(proof),/differs/);
});
