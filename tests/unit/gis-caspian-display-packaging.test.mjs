import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {zipFixture} from '../helpers/geonames-fixtures.mjs';
import {MEMBER} from '../../tools/gis/verify-approved-caspian-network.mjs';
import {WATER_MEMBER,holes,geometryFromDocument,inputFromPinnedCaspianZip,
  generateApprovedCaspianDisplay,validateDisplayCandidate}
  from '../../tools/gis/generalize-approved-caspian-display.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const points=[[48,42],[49,42],[49,43],[48,43],[48,42]];
const sampleNetwork={type:'FeatureCollection',features:points.slice(0,-1).map((p,i)=>({
  type:'Feature',id:String(i),properties:{
    hybrid_id:'approved-'+i,hybrid_role:'NOT_COAST',simplification_m:0,
  },geometry:{type:'LineString',coordinates:[p,points[i+1]]},
}))};
const water={type:'FeatureCollection',features:[{type:'Feature',properties:{},
  geometry:{type:'Polygon',coordinates:[points]}}]};
function twoMembers(a,b){
  const split=data=>{
    const eocd=data.length-22;
    const offset=data.readUInt32LE(eocd+16),length=data.readUInt32LE(eocd+12);
    return {local:data.subarray(0,offset),
      central:data.subarray(offset,offset+length)};
  };
  const left=split(a),right=split(b);
  const updated=Buffer.from(right.central);
  updated.writeUInt32LE(left.local.length,42);
  const eocd=Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50,0);
  eocd.writeUInt16LE(2,8);eocd.writeUInt16LE(2,10);
  eocd.writeUInt32LE(left.central.length+updated.length,12);
  eocd.writeUInt32LE(left.local.length+right.local.length,16);
  return Buffer.concat([left.local,right.local,left.central,updated,eocd]);
}
function prepared(t){
  const dir=mkdtempSync(join(tmpdir(),'caspian-source-pair-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const networkBytes=Buffer.from(JSON.stringify(sampleNetwork));
  const zip=twoMembers(zipFixture(MEMBER,networkBytes.toString('utf8'),{deflate:true}),
    zipFixture(WATER_MEMBER,JSON.stringify(water),{deflate:true}));
  const path=join(dir,'pinned.zip');
  writeFileSync(path,zip);
  return {dir,path,zip,archiveSha:hash(zip),networkSha:hash(networkBytes)};
}
test('original water GeoJSON extracts one frozen polygon and exact interior ring count',()=>{
 assert.equal(geometryFromDocument(water).type,'Polygon');
 assert.equal(holes(geometryFromDocument(water)),0);
 assert.equal(holes({type:'MultiPolygon',coordinates:[[points]]}),0);
 assert.throws(()=>geometryFromDocument({type:'FeatureCollection',features:[]}),/one polygon/);
});
test('multi-member ZIP loader verifies both approved network and reference water',async t=>{
 const sample=prepared(t);
 const fixture=await inputFromPinnedCaspianZip(sample.path,{
  expectedArchiveSha:sample.archiveSha,expectedMemberSha:sample.networkSha,
  expectedFeatures:4,expectedHoles:0,
 });
 assert.equal(fixture.input.network.features.length,4);
 assert.equal(fixture.input.expectedHoles,0);
 assert.deepEqual(fixture.input.water,water.features[0].geometry);
 await assert.rejects(inputFromPinnedCaspianZip(sample.path,{
  expectedArchiveSha:'0'.repeat(64),expectedMemberSha:sample.networkSha,
  expectedFeatures:4,expectedHoles:0,
 }),/SHA-256/);
});
test('native candidate built from a frozen ZIP preserves every protected line and original bytes',async t=>{
 assert.ok(binary,'Need native historical GEOS recipe');
 const sample=prepared(t),output=join(sample.dir,'candidate.json');
 const receipt=await generateApprovedCaspianDisplay(sample.path,{
  binary,output,expectedArchiveSha:sample.archiveSha,
  expectedMemberSha:sample.networkSha,expectedFeatures:4,expectedHoles:0,
 });
 assert.equal(receipt.sourceZipUnchanged,true);
 assert.equal(receipt.status,'review-only-not-approved-for-runtime');
 assert.equal(receipt.metrics.nonEndpointIntersections,0);
 assert.equal(receipt.metrics.holesAfter,0);
 assert.ok(existsSync(output));
 const derived=JSON.parse(readFileSync(output,'utf8'));
 assert.equal(derived.network.features.length,4);
 assert.deepEqual(derived.network.features[0].properties,sampleNetwork.features[0].properties);
 assert.deepEqual(derived.network.features[0].geometry,sampleNetwork.features[0].geometry);
 assert.deepEqual(readFileSync(sample.path),sample.zip);
 await assert.rejects(generateApprovedCaspianDisplay(sample.path,{
  binary,output,expectedArchiveSha:sample.archiveSha,
  expectedMemberSha:sample.networkSha,expectedFeatures:4,expectedHoles:0,
 }),/Refusing to replace/);
});
test('an altered source role, shifted endpoint or collapsed water ring is never accepted',()=>{
 const input={network:sampleNetwork,water:water.features[0].geometry,expectedHoles:0};
 const output={
  network:structuredClone(sampleNetwork),
  water:{type:'MultiPolygon',coordinates:[[points]]},
  metrics:{holesBefore:0,holesAfter:0,verticesBefore:8,verticesAfter:8,
    adaptiveLocalRepairs:0,boundaryHausdorffMeters:0,nonEndpointIntersections:0,
    perFeatureToleranceMeters:sampleNetwork.features.map(x=>({
      id:x.properties.hybrid_id,tolerance:0,
    }))},
 };
 assert.equal(validateDisplayCandidate(input,output).verticesAfter,8);
 const moved=structuredClone(output);moved.network.features[0].geometry.coordinates[0]=[48.1,42];
 assert.throws(()=>validateDisplayCandidate(input,moved),/junction/);
 const lost=structuredClone(output);lost.water.coordinates[0].push(points);
 assert.throws(()=>validateDisplayCandidate(input,lost),/hole topology/);
 const unapproved=structuredClone(output);unapproved.network.features[1].properties.hybrid_role='OTHER';
 assert.throws(()=>validateDisplayCandidate(input,unapproved),/provenance/);
});
