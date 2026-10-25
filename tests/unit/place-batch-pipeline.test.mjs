import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA, STAGING_STATUS, audit, registered, plan, readJson, writeNewJson,
  finalize, validateReviewed } from '../../tools/place-batch-pipeline.mjs';

const json=(place,value)=>writeFileSync(place,JSON.stringify(value));
function folder(t){
 const root=mkdtempSync(join(tmpdir(),'place-batch-'));
 t.after(()=>rmSync(root,{force:true,recursive:true}));
 return root;
}
function city(id=23){
 return {geonameId:id,names:[
  {text:'옛도시',language:'ko',usage:'historical'},
  {text:'Oldtown',language:'en',usage:'historical'},
  {text:'古町',language:'ja',usage:'historical'},
  {text:'신도시',language:'ko',usage:'standard'},
  {text:'Newtown',language:'en',usage:'standard'},
  {text:'新町',language:'ja',usage:'standard'}],
 latitude:35,longitude:130,featureClass:'P',featureCode:'PPLC',sourceCountryCode:'JP',
 sourceUrl:'https://www.geonames.org/'+id+'/',
 defaultDisplayNameKo:'신도시',defaultDisplayNameEn:'Newtown',
 defaultDisplayNameNative:'新町',defaultNativeLanguage:'ja',
 shortDescriptionKo:'1888년 신도시로 개칭',
 displayTimeline:[
  {fromYear:1801,nameKo:'옛도시',nameEn:'Oldtown',nameNative:'古町',
   nativeLanguage:'ja',kind:'historicalLocalName',sourceUrl:'https://example.com/old'},
  {fromDate:'1888-07-13',nameKo:'신도시',nameEn:'Newtown',nameNative:'新町',
   nativeLanguage:'ja',kind:'officialRenaming',sourceUrl:'https://example.com/new'}]};
}
function reviewed(...records){return {schema:SCHEMA,batch:'16-sample',status:STAGING_STATUS,
 source:'GeoNames + authenticated municipal source',checkedOn:'2026-10-11',records};}
function candidate(id,country='JP',population=1000,code='PPL'){
 return {geonameId:id,name:'City'+id,countryCode:country,latitude:35,longitude:131,
 featureClass:'P',featureCode:code,population};
}
test('existing legacy batches are audited without rewriting old source',t=>{
 const root=folder(t);
 json(join(root,'tier1-major-cities-batch15-test.json'),{schema:SCHEMA,records:[{geonameId:23,displayTimeline:[{fromYear:1801}]}]});
 assert.deepEqual(audit(root),{batchFiles:1,cities:1,nameTimelineEntries:1,legacyTimelineEntriesWithoutSourceUrl:1,
 scope:'staged historical name data, not runtime or historical city ranking'});
 json(join(root,'tier1-major-cities-batch14-test.json'),{schema:SCHEMA,records:[{geonameId:23}]});
 assert.throws(()=>registered(root),/Duplicate GeoNames ID/);
});
test('candidate plan prioritizes capitals, removes staged IDs and does not approve names',async t=>{
 const root=folder(t),places=join(root,'places');mkdirSync(places);
 json(join(places,'tier1-major-cities-batch15-test.json'),{schema:SCHEMA,records:[{geonameId:1}]});
 const source=join(root,'candidates.ndjson');
 writeFileSync(source,[candidate(1,'JP',9999999),candidate(2,'JP',5000000),
  candidate(3,'JP',20,'PPLC'),candidate(4,'FR',800000),candidate(5,'JP',100000)]
  .map(x=>JSON.stringify(x)+'\n').join(''));
 const result=await plan(source,places,{batch:16,limit:3,countries:['JP']});
 assert.deepEqual(result.candidates.map(x=>x.geonameId),[3,2,5]);
 assert.equal(result.status,'unreviewed-candidates-not-city-approval');
 assert.equal(result.counts.previouslyStaged,1);
 const filtered=await plan(source,places,{batch:16,minPopulation:100001});
 assert.deepEqual(filtered.candidates.map(x=>x.geonameId),[2,4]);
 await assert.rejects(plan(source,places,{batch:15}),/already exists/);
});
test('input SHA-256 mismatch, duplicate candidates and atomic output replacement are rejected',async t=>{
 const root=folder(t),input=join(root,'candidates.ndjson'),summary=join(root,'summary.json');
 writeFileSync(input,JSON.stringify(candidate(5))+'\n');
 json(summary,{refinedArtifact:{sha256:'bad'}});
 await assert.rejects(plan(input,root,{batch:16,reviewedSummary:summary}),/SHA-256/);
 writeFileSync(input,(JSON.stringify(candidate(5))+'\n').repeat(2));
 await assert.rejects(plan(input,root,{batch:16}),/Duplicate candidate/);
 const out=join(root,'new.json');
 writeNewJson(out,{one:1});
 assert.throws(()=>writeNewJson(out,{two:2}),/overwrite/);
 assert.deepEqual(readJson(out),{one:1});
});
test('finalize checks verified staging and creates only a new batch',t=>{
 const root=folder(t),src=join(root,'reviewed.json'),dest=join(root,'tier1-major-cities-batch16-sample.json');
 json(src,reviewed(city()));
 assert.deepEqual(finalize(src,dest,root,{check:true}),{validatedCities:1,validatedPeriods:2});
 assert.equal(existsSync(dest),false);
 finalize(src,dest,root);
 assert.equal(readJson(dest).records[0].geonameId,23);
 assert.throws(()=>finalize(src,dest,root),/overwrite/);
});
test('date validity, approval status, name source and duplicate IDs remain strict',()=>{
 const input=reviewed(city()), mutate=f=>{const value=structuredClone(input);f(value);return value;};
 assert.throws(()=>validateReviewed(mutate(x=>x.status='unreviewed')),/unreviewed/);
 assert.throws(()=>validateReviewed(mutate(x=>x.records[0].displayTimeline[1].fromDate='1888-02-30')),/Gregorian date/);
 assert.throws(()=>validateReviewed(mutate(x=>x.records[0].displayTimeline[1].fromDate='1888-7-13')),/Gregorian date/);
 assert.throws(()=>validateReviewed(mutate(x=>x.records[0].displayTimeline[1].nameKo='가짜')),/not listed/);
 assert.throws(()=>validateReviewed(mutate(x=>delete x.records[0].displayTimeline[1].sourceUrl)),/sourceUrl/);
 assert.throws(()=>validateReviewed(mutate(x=>x.records[0].defaultDisplayNameKo='거짓')),/disagrees/);
 assert.throws(()=>validateReviewed(mutate(x=>x.records[0].displayTimeline[1].fromYear=1888)),/XOR/);
 assert.throws(()=>validateReviewed(reviewed(city(),city())),/Duplicate/);
});
test('same-spelling English and native may share a names[] row without invented aliases',()=>{
 const record=city();
 record.displayTimeline[0].nameNative='Oldtown';
 record.displayTimeline[1].nameNative='Newtown';
 record.defaultDisplayNameNative='Newtown';
 record.names=record.names.filter(x=>x.language!=='ja');
 assert.equal(validateReviewed(reviewed(record)).validatedCities,1);
 record.displayTimeline[1].nameNative='Invented';
 record.defaultDisplayNameNative='Invented';
 assert.throws(()=>validateReviewed(reviewed(record)),/not listed/);
});
test('two exact changes in a year are valid; mixing a year-only boundary is ambiguous',()=>{
 const record=city();
 record.names.push({text:'중간도시',language:'ko'});
 record.displayTimeline.splice(1,0,{fromDate:'1888-02-01',nameKo:'중간도시',
  kind:'editorial',sourceUrl:'https://example.com/x'});
 assert.equal(validateReviewed(reviewed(record)).validatedPeriods,3);
 record.displayTimeline[1]={fromYear:1888,nameKo:'중간도시',kind:'editorial',sourceUrl:'https://example.com/x'};
 assert.throws(()=>validateReviewed(reviewed(record)),/uncertain same-year/);
});
