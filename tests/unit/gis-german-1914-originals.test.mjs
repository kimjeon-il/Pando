import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import test from 'node:test';
import {inventory,extractArchived,verifyHistoricalStateSource,verifyCanonicalDEU,
  audit,PATHS,APPROVED_NE_SHA,HISTOGIS_SHA,WORKING_SHA,DIAGNOSTICS_SHA}
 from '../../tools/gis/verify-german-1914-originals.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const sq=(w,s,e,n)=>[[w,s],[e,s],[e,n],[w,n],[w,s]];
const german=(name,w=10)=>({type:'Feature',properties:{STAAT_NAME:name},
 geometry:{type:'Polygon',coordinates:[sq(w,50,w+.01,50.01)]}});
const recipe=()=>({
 referenceDate:'1914-07-31',nativeStatus:'pending-actual-hgis-source-hash-and-geometry-oracle',
 sources:{hgisStates:{path:PATHS.hgis,expectedFeatureCount:26,
   expectedBounds:[4.490331,47.03629,23.157687,56.025202],
   boundsToleranceDegrees:.35},
  canonicalCountries:{path:PATHS.naturalEarth,sha256:APPROVED_NE_SHA}},
});
const index=()=>({files:Object.fromEntries([
  [PATHS.naturalEarth,APPROVED_NE_SHA],
  [PATHS.histogis,HISTOGIS_SHA],
  [PATHS.working,WORKING_SHA],
  [PATHS.workingDiagnostics,DIAGNOSTICS_SHA],
].map(([path,sha256])=>[path,{sha256,bytes:16,stored:path,encoding:'identity'}]))});
test('original Harvard 26-state HGIS absence is blocked, never substituted by HistoGIS 27-polygon working geometry',()=>{
 const current=inventory(index(),recipe());
 assert.equal(current.hgisIndexed,false);
 assert.equal(current.generatedIndexed,false);
 assert.equal(current.distinctHistoGISSourceIndexed,true);
 const altered=recipe();
 altered.sources.canonicalCountries.sha256='168286e9'.padEnd(64,'0');
 assert.throws(()=>inventory(index(),altered),/digest/);
});
test('pinned archive byte and decompression verification rejects replacement sources',()=>{
 const bytes=Buffer.from('immutable-geojson'),path='test.geojson';
 const entry={sha256:hash(bytes),bytes:bytes.length,
   stored:'archive/blobs/'+hash(bytes)+'.gz',encoding:'gzip'};
 const receipt={files:{[path]:entry}};
 assert.equal(extractArchived(receipt,path,gzipSync(bytes)).sha256,entry.sha256);
 assert.throws(()=>extractArchived(receipt,path,gzipSync(Buffer.from('tampered'))),
   /mismatch/);
});
test('strict HGIS 26-state source validation rejects wrong feature counts and duplicate identities',()=>{
 const normal={type:'FeatureCollection',features:Array.from({length:26},(_,i)=>german('State '+i))};
 assert.throws(()=>verifyHistoricalStateSource(normal,recipe()),/bounds/);
 const bad=structuredClone(normal);
 bad.features.pop();
 assert.throws(()=>verifyHistoricalStateSource(bad,recipe()),/26-feature/);
 normal.features[1].properties.STAAT_NAME='State 0';
 assert.throws(()=>verifyHistoricalStateSource(normal,recipe()),/duplicate/);
});
test('canonical donor requires one identifiable DEU feature',()=>{
 const one={type:'FeatureCollection',features:[
   {id:'DEU',geometry:{type:'Polygon',coordinates:[sq(7.88,54.17,7.9,54.2)]}}
 ]};
 assert.equal(verifyCanonicalDEU(one).countryId,'DEU');
 one.features.push(structuredClone(one.features[0]));
 assert.throws(()=>verifyCanonicalDEU(one),/duplicated/);
});
test('an archived secondary working map cannot be promoted to HGIS',async()=>{
 const ne=Buffer.from(JSON.stringify({type:'FeatureCollection',
   features:[{id:'DEU',geometry:{type:'Polygon',coordinates:[sq(7.88,54.17,7.9,54.2)]}}]}));
 const legacy=Buffer.from(JSON.stringify({referenceDate:'1914-07-31',
   source:{repository:'acdh-oeaw/histogis-data',sourcePolygonCount:27,license:'CC BY 4.0'}}));
 const fixtures={naturalEarth:ne,histogis:Buffer.from('histo'),
   working:Buffer.from('working'),workingDiagnostics:legacy};
 const mocked={files:Object.fromEntries(Object.entries(fixtures).map(([key,value])=>[
   PATHS[key],{bytes:value.length,sha256:hash(value),
     stored:PATHS[key],encoding:'identity'}]))};
 const configured=recipe();
 configured.sources.canonicalCountries.sha256=hash(ne);
 // The audit rejects changing even the verified modern NE source release.
 await assert.rejects(audit(mocked,configured,{
   revision:'f'.repeat(40),readOriginal:async path=>
     fixtures[Object.keys(fixtures).find(k=>PATHS[k]===path)],
   native:()=>({passed:true,componentCount:2}),
 }),/digest/);
});
