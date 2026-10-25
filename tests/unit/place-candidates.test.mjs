import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRow, candidate, POLICY, summarize, validateCandidates,
  auditKept, scanPrimary, sourceRows } from '../../tools/lib/geonames-policy.mjs';
import { applyReviewOverrides, refineCandidates, review } from '../../tools/lib/geonames-review.mjs';
import { fetchSources, build, writeJson } from '../../tools/build-place-candidates.mjs';
import { zipMembers, zipTextLines, verifyZip } from '../../tools/lib/geonames-zip.mjs';
import { sourceLine, snapshot, ledger } from '../helpers/geonames-fixtures.mjs';
const rec=values=>parseRow(sourceLine(values))[0];
const temp=t=>{const dir=mkdtempSync(join(tmpdir(),'geonames-node-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;};
const report=(folder,name='report.md')=>{
 const path=join(folder,name);
 writeFileSync(path,'Manual analysis\n<!-- geonames-statistics:start -->\n<!-- geonames-statistics:end -->\nPreserve me\n');
 return path;
};
const deep=value=>structuredClone(value);
const ids=rows=>rows.map(x=>x.geonameId);
const rejects=(fn,re)=>assert.throws(fn,re);
const rejectsAsync=(fn,re)=>assert.rejects(fn,re);

test('zero population administrative capitals and seats retain their inclusion reason',()=>{
 for(const [code,reason] of Object.entries(POLICY.adminReasons)){
   const v=candidate(rec({code,population:'0'}));
   assert.equal(v.inclusionReason,reason);
   assert.equal(v.populationBucket,'under-50k-admin');
   assert.equal(v.preliminaryDisplayMode,'search-only');
 }
});
test('population inclusion thresholds preserve exclusive buckets and display modes',()=>{
 assert.equal(candidate(rec({population:String(POLICY.populationMinimum-1)})),null);
 for(const [key,bucket,mode] of [['populationMinimum','50k-99k','search-only'],
     ['autoReviewMinimum','100k-999k','auto-review'],['millionMinimum','1m-plus','auto-review']]){
   const v=candidate(rec({population:String(POLICY[key])}));
   assert.equal(v.populationBucket,bucket);assert.equal(v.preliminaryDisplayMode,mode);
 }
});
test('unadopted feature codes cannot be promoted even with very high population',()=>{
 for(const code of ['PPLA3','PPLA4','PPLA5','PPLX','PPLL','PPLS','PPLF','PPLH',
   'PPLCH','PPLQ','PPLW','PPLR','STLMT'])
   assert.equal(candidate(rec({code,population:'2000000'})),null);
 assert.equal(candidate({...rec({code:'PPLC'}),featureClass:'H'}),null);
});
test('modern country code and name never gate administrative inclusion',()=>{
 for(const country of ['KR','JP','CN','IN','US','BR','','GL'])
   assert.ok(candidate(rec({country,code:'PPLA2',population:'0',name:'Airport District-dong'})));
});
test('Unicode and missing source population are not silently dropped',()=>{
 const [row,missing]=parseRow(sourceLine({name:'서울',code:'PPLC',population:''}));
 assert.equal(missing,true);assert.equal(row.population,0);
 assert.equal(row.name,'서울');assert.ok(candidate(row));
});
test('malformed coordinates, ID, population and field counts are rejected',()=>{
 for(const v of [{latitude:'91'},{latitude:'nan'},{longitude:'-181'},
   {population:'-1'},{population:'oops'},{id:0}])
   rejects(()=>parseRow(sourceLine(v)),/invalid|negative/);
 rejects(()=>parseRow('1\tbroken\n'),/19 columns/);
});
test('only canonical candidate fields and unique ID values can enter output',()=>{
 const value=candidate(rec({}));validateCandidates([value]);
 rejects(()=>validateCandidates([value,{...value}]),/duplicate/);
 rejects(()=>validateCandidates([{...value,population:1}]),/violates canonical policy/);
});
test('near-duplicate audit never merges names or aliases',()=>{
 const rows=[candidate(rec({id:1,name:'Airport District-dong'})),
   candidate(rec({id:2,name:'Airport District-dong',longitude:'127.001'})),
   candidate(rec({id:3,name:'Other',country:''}))];
 const before=deep(rows),stats=auditKept(rows);
 assert.equal(stats.nearSameNamePairCount,1);
 assert.equal(stats.nameSignalCount,2);assert.equal(stats.koreanMicroNameCount,2);
 assert.equal(stats.missingCountryCodeCount,1);assert.deepEqual(rows,before);
 validateCandidates(rows);
});
test('cumulative population counts cannot be substituted for exclusive buckets',()=>{
 const rows=[0,POLICY.populationMinimum,POLICY.autoReviewMinimum,POLICY.millionMinimum]
   .map((population,i)=>candidate(rec({id:i+1,code:'PPLA',population:String(population)})));
 const result=summarize(rows);
 assert.equal(result.population100kPlus,2);
 assert.equal(result.population50kPlus,3);
 assert.equal(result.population1mPlus,1);
 assert.equal(result.under50kAdminSeats,1);
});
test('verified offline build is deterministic and supplementary data is audit only',async t=>{
 const cache=temp(t),lines=[sourceLine({id:1,code:'PPLC',population:'0'}),
   sourceLine({id:2}),sourceLine({id:3,code:'PPLA3',population:'200000'}),
   sourceLine({id:4,code:'PPLX',population:'200000'})];
 snapshot(cache,'cities500',lines,{deflate:true});
 snapshot(cache,'allCountries',[...lines,sourceLine({id:5,code:'PPLG',population:'0'})]);
 const path=report(cache),statsPath=join(cache,'stats.json');
 const first=await build(cache,statsPath,path);
 assert.equal(first.totals.totalKept,2);
 assert.equal(first.primary.rawRows,4);
 assert.equal(first.supplement.eligibleMissingFromPrimary[0].geonameId,5);
 assert.deepEqual(first.primary.excludedPCodes,{PPLA3:1,PPLX:1});
 const keep=[statsPath,join(cache,'candidates.ndjson'),path].map(p=>readFileSync(p));
 await build(cache,statsPath,path);
 const now=[statsPath,join(cache,'candidates.ndjson'),path].map(p=>readFileSync(p));
 assert.deepEqual(now,keep);assert.match(readFileSync(path,'utf8'),/Preserve me/);
 const metadata=JSON.parse(readFileSync(join(cache,'cities500.source.json')));
 metadata.sha256='wrong';writeJson(join(cache,'cities500.source.json'),metadata);
 await rejectsAsync(()=>build(cache,statsPath,path),/checksum mismatch/);
});
test('duplicate source IDs fail before candidate artifacts are written',async t=>{
 const cache=temp(t);snapshot(cache,'cities500',[sourceLine(),sourceLine()]);
 await rejectsAsync(()=>scanPrimary('cities500',cache),/duplicate geonameId/);
 assert.equal(existsSync(join(cache,'candidates.ndjson')),false);
});
test('Korean micro-alias report does not add alternateNames into candidate',async t=>{
 const cache=temp(t);
 snapshot(cache,'cities500',[sourceLine({aliases:'Town,Example-eup,예시읍'})]);
 const [rows,stats]=await scanPrimary('cities500',cache);
 assert.equal(rows.length,1);
 assert.deepEqual(stats.koreanMicroAliasSignals[0].matchedAliases,['Example-eup','예시읍']);
 assert.equal(Object.hasOwn(rows[0],'alternateNames'),false);
});
test('official fallback always follows primary attempt in the same order',async t=>{
 const cache=temp(t),calls=[];
 const results=[{source:'cities500',status:'failed',failures:[{stage:'official-download',error:'HTTP 503'}]},
   {source:'allCountries',status:'downloaded',failures:[]}];
 const out=await fetchSources(cache,{fetchSource:async name=>{calls.push(name);return results[calls.length-1];}});
 assert.deepEqual(calls,['cities500','allCountries']);
 assert.deepEqual(out,results);
 assert.deepEqual(JSON.parse(readFileSync(join(cache,'fetch-attempts.json'))),results);
});
test('allCountries alone may be the verified primary without silent source promotion',async t=>{
 const cache=temp(t);
 snapshot(cache,'allCountries',[sourceLine({code:'PPLC',population:'0'})]);
 const data=await build(cache,join(cache,'stats.json'),report(cache));
 assert.equal(data.primarySource,'allCountries');
 assert.equal(data.totals.totalKept,1);assert.equal(data.supplement,null);
});
test('ZIP metadata, deflate, entire-member CRC and source checksum reject bad data',async t=>{
 const cache=temp(t);
 snapshot(cache,'cities500',[sourceLine({name:'서울'})],{deflate:true});
 const files=await zipMembers(join(cache,'cities500.zip'));
 assert.equal(files[0].timeISO,'2026-10-01T00:00:00');
 assert.equal((await verifyZip(join(cache,'cities500.zip'),'cities500.txt')).name,'cities500.txt');
 const rows=[];
 for await(const line of zipTextLines(join(cache,'cities500.zip'),'cities500.txt'))rows.push(line);
 assert.equal(rows.length,1);
 assert.ok(rows[0].includes('서울'));
 snapshot(cache,'allCountries',[sourceLine()],{corruptCrc:true});
 await rejectsAsync(()=>verifyZip(join(cache,'allCountries.zip'),'allCountries.txt'),/CRC/);
 await rejectsAsync(async()=>{for await(const row of sourceRows('allCountries',cache)){assert.ok(row);}},/CRC/);
});
test('review overrides update only explicit ID decision and never mutate original',()=>{
 const row=rec({}),ledgerObj=ledger([row],['hold']);
 ledgerObj.source={name:'cities500',sha256:'fixture-source'};
 const before=deep(ledgerObj);
 const changes={version:1,sourceSha256:'fixture-source',overrides:[{
   geonameId:1,action:'retain',reasonAppend:'Coordinate identity review accepted.',
   coordinateCorrectionRef:'reports/places/coordinate-corrections.json#1'}]};
 const result=applyReviewOverrides(ledgerObj,changes);
 assert.deepEqual(ledgerObj,before);
 assert.equal(result.decisions[0].action,'retain');
 assert.match(result.decisions[0].reason,/Coordinate identity review accepted/);
 assert.equal(result.decisions[0].coordinateCorrectionRef,'reports/places/coordinate-corrections.json#1');
});
test('review overrides reject unknown and duplicate IDs',()=>{
 const source=ledger([rec({})],['hold']);
 source.source={name:'cities500',sha256:'fixture-source'};
 rejects(()=>applyReviewOverrides(source,{version:1,sourceSha256:'fixture-source',
   overrides:[{geonameId:2,action:'retain'}]}),/unknown review ID 2/);
 rejects(()=>applyReviewOverrides(source,{version:1,sourceSha256:'fixture-source',
   overrides:[{geonameId:1,action:'retain'},{geonameId:1,action:'retain'}]}),/duplicate override ID 1/);
});
test('hold/exclude do not promote unreviewed names or change source data',()=>{
 const raw=['PPL','PPLA2','PPL','PPLA3'].map((code,i)=>rec({id:i+1,code,name:'Same name'}));
 const base=raw.map(candidate).filter(Boolean),sources=new Map(raw.map(x=>[x.geonameId,x]));
 const decisions=ledger(raw,['retain','exclude','hold','inclusion-review']);
 const before=deep([base,[...sources],decisions]);
 const [refined,reviewed]=refineCandidates(base,sources,decisions);
 assert.deepEqual(ids(refined),[1]);
 assert.deepEqual(reviewed.map(x=>x.inBaseline),[true,true,true,false]);
 assert.deepEqual([base,[...sources],decisions],before);
 validateCandidates(refined);
});
test('different IDs or keyword-heavy names are never silently merged',()=>{
 const raw=['127','127','127.001'].map((longitude,i)=>
   rec({id:i+1,name:'College Station District',longitude}));
 const base=raw.map(candidate);
 const [result]=refineCandidates(base,new Map(raw.map(r=>[r.geonameId,r])),
   ledger(raw.slice(0,1),['retain']));
 assert.deepEqual(result,base);
});
test('the same name but changed coordinates/country/type needs another review',()=>{
 const row=rec({name:'Ōta',country:'JP',code:'PPLA2'});
 for(const [key,value] of [['countryCode','KR'],['featureCode','PPL'],
   ['latitude',35.56126],['longitude',139.71605],['name','Ota']]){
   const data=ledger([row],['exclude']);
   data.decisions[0].expected[key]=value;
   rejects(()=>refineCandidates([candidate(row)],new Map([[1,row]]),data),/identity changed/);
 }
});
test('unsupported review promotion and actions are rejected',()=>{
 const excluded=rec({code:'PPLA3'});
 rejects(()=>refineCandidates([],new Map([[1,excluded]]),ledger([excluded],['retain'])),/cannot promote/);
 const included=rec({});
 const input=ledger([included],['inclusion-review']);
 rejects(()=>refineCandidates([candidate(included)],new Map([[1,included]]),input),/requires an excluded/);
 input.decisions[0].action='rename';
 rejects(()=>refineCandidates([candidate(included)],new Map([[1,included]]),input),/unknown action/);
});
test('duplicate/missing review source and missing independent evidence are rejected',()=>{
 const row=rec({}),base=[candidate(row)],sources=new Map([[1,row]]);
 rejects(()=>refineCandidates(base,sources,ledger([row,row],['retain','retain'])),/duplicate review ID/);
 const input=ledger([row],['retain']);
 rejects(()=>refineCandidates(base,new Map(),input),/missing source record/);
 input.decisions[0].evidence=['not-reviewed'];
 rejects(()=>refineCandidates(base,sources,input),/unknown evidence/);
 input.decisions[0].evidence=['official'];
 delete input.evidenceSources.official.finding;
 rejects(()=>refineCandidates(base,sources,input),/missing source provenance/);
});
test('unapproved excluded/held records do not enter pool; baseline mismatch fails',()=>{
 const excluded=rec({code:'PPLA3'});
 const [refined,reviewed]=refineCandidates([],new Map([[1,excluded]]),ledger([excluded],['hold']));
 assert.deepEqual(refined,[]);assert.equal(reviewed[0].inBaseline,false);
 const row=rec({});
 rejects(()=>refineCandidates([],new Map([[1,row]]),ledger([row],['hold'])),/baseline\/source mismatch/);
});
test('offline reviewed output is deterministic; original candidates and unsourced drift stay safe',async t=>{
 const cache=temp(t),lines=[sourceLine({id:1,name:'City'}),
   sourceLine({id:2,name:'Ward',code:'PPLA2'}),
   sourceLine({id:3,name:'Missing city',code:'PPLA3'})];
 const meta=snapshot(cache,'cities500',lines);
 const raw=lines.map(x=>parseRow(x)[0]);
 const source=ledger(raw,['retain','exclude','inclusion-review']);
 source.source={name:'cities500',sha256:meta.sha256};
 writeJson(join(cache,'reviews.json'),source);
 const original=join(cache,'candidates.ndjson');
 writeFileSync(original,'Preserve original candidates\n');
 const path=report(cache,'review.md'),summary=join(cache,'summary.json');
 const data=await review(cache,join(cache,'reviews.json'),summary,path);
 assert.deepEqual([data.baselineCount,data.refinedCount,data.baselineExcludes],[2,1,1]);
 assert.equal(data.unreviewedCount,0);
 assert.equal(readFileSync(original,'utf8'),'Preserve original candidates\n');
 const outputs=[join(cache,'refined-candidates.ndjson'),summary,path].map(p=>readFileSync(p));
 await review(cache,join(cache,'reviews.json'),summary,path);
 assert.deepEqual([join(cache,'refined-candidates.ndjson'),summary,path].map(p=>readFileSync(p)),outputs);
 assert.match(readFileSync(path,'utf8'),/Manual analysis/);
 source.source.sha256='new-snapshot';writeJson(join(cache,'reviews.json'),source);
 await rejectsAsync(()=>review(cache,join(cache,'reviews.json'),summary,path),/snapshot changed/);
 assert.deepEqual([join(cache,'refined-candidates.ndjson'),summary,path].map(p=>readFileSync(p)),outputs);
});
