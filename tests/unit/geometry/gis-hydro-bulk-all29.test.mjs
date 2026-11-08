import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {reviewRemaining29} from "../../../tools/gis/stage-hydro-all-nonosm.mjs";
import {ORIGINAL_OSM_SYSTEM_IDS} from "../../../tools/gis/audit-osm-credit-removal.mjs";

const root=new URL("../../../",import.meta.url);
const read=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const remaining=read('tools/gis/hydro-bulk-independent-remaining29.json');
const review=read('tools/gis/hydro-followup-independent-name-replacements.json');
const inventory=read('tools/gis/osm-independent-river-source-inventory.json');

test('single atomic source contract includes exactly all 31 original OSM-linked systems',()=>{
 const proof=reviewRemaining29(remaining,inventory,review);
 assert.equal(proof.systemIds.length,31);
 assert.deepEqual(proof.systemIds,[...ORIGINAL_OSM_SYSTEM_IDS].sort((a,b)=>Number(a)-Number(b)));
 assert.equal(proof.named.length,19);
 assert.equal(proof.neutral.length,10);
 assert.deepEqual(proof.regionTotals,{af:2,eu:11,si:1,as:17});
 assert(proof.named.every(id=>!proof.neutral.includes(id)));
 assert(proof.systemIds.every(id=>Object.hasOwn(proof.substitutions,id)));
 assert.equal(proof.substitutions['20773860'].hydroRiversRegion,'eu');
 assert.equal(proof.substitutions['40423228'].hydroRiversRegion,'as');
});

test('only strong non-OSM map matches may rename the Indus, Brahmaputra, Yom system names',()=>{
 const by=Object.fromEntries(remaining.substitutions.map(x=>[x.systemId,x]));
 assert.deepEqual(['41023100','41067217','41337891'].map(x=>by[x].nameKo),
   ['인더스강','브라마푸트라강','욤강']);
 assert(by['41023100'].reviewStatement.includes('Ravi just 7/81'));
 assert(by['41337891'].reviewStatement.includes('Pasak absent'));
 assert.equal(by['40415850'].nameKo,'임진강');
 assert.equal(by['40415850'].previousNameKo,'림진강/임진강');
 for(const id of ['41023100','41067217','41337891']){
   const leader=inventory.rows.find(x=>x.systemId===id).naturalEarthGeometryScreen.candidates[0];
   assert(leader.sampleCoverage>=0.6);
 }
});

test('ten ambiguous or originally unlabelled systems have no OSM-derived names or aliases',()=>{
 const proof=reviewRemaining29(remaining,inventory,review);
 const cases=new Set([
  '10526283','20628098','20774342','40188382','41109275',
  '41171836','41182380','41386179','41386700','41390476',
 ]);
 assert.deepEqual(new Set(proof.neutral),cases);
 for(const id of proof.neutral){
   const row=proof.substitutions[id];
   assert.equal(row.nameKo,'미명명 수계 '+id);
   assert.deepEqual(row.aliases,[]);
   assert.deepEqual(row.tributaryNames,[]);
   assert.deepEqual(row.independentSources,[{
     kind:'primary-hydrorivers-geometry',url:'https://www.hydrosheds.org/products/hydrorivers'
   }]);
 }
});

test('a leaked alias, foreign-source URL, fabricated mainstem candidate or wrong region fails closed',()=>{
 function bad(mutator){
   const input=structuredClone(remaining);
   mutator(input);
   assert.throws(()=>reviewRemaining29(input,inventory,review));
 }
 bad(d=>d.substitutions[0].aliases.push('unverified name'));
 bad(d=>d.substitutions[0].independentSources[0].url='https://www.openstreetmap.org/relation/1');
 bad(d=>d.substitutions[0].hydroRiversRegion='eu');
 bad(d=>d.substitutions.find(x=>x.systemId==='41023100').nameKo='라비강');
 bad(d=>d.substitutions.find(x=>x.systemId==='41337891').evidence.naturalEarthCandidateSampleCoverage[0].matched=99);
 bad(d=>d.substitutions.pop());
 bad(d=>d.substitutions.find(x=>x.systemId==='20774342').classification='independent-geographical-reach-name');
});

test('current candidate receipt never misrepresents the GIS geometry or provenance scope',()=>{
 assert.equal(remaining.sourceIndependentNamedSystems,19);
 assert.equal(remaining.neutralizedUnverifiedNameSystems,10);
 assert.equal(remaining.originalHydroVersion,'0.13.2');
 assert.equal(remaining.originalBundleSha256,inventory.pinnedBundleSha256);
 assert.equal(remaining.substitutions.length,29);
 assert(remaining.substitutions.every(x=>x.geometryChanged===false&&x.osmNamesOrRelationsReused===false));
});
