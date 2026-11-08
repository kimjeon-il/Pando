import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {inspectCanonicalInputs} from '../../../scripts/lib/library-auto-inputs.mjs';
const baselineRevision='a'.repeat(40),revision='b'.repeat(40),BASE='assets/data/territorial-entities/source/';
const hash=b=>createHash('sha256').update(b).digest('hex'),bytes=x=>Buffer.from(JSON.stringify(x));
const raw=()=>({schemaVersion:2,entityId:'state:AAA',lineageId:'aaa',entityKind:'general',names:{en:'A'},lifetime:{validFrom:null,validTo:null},parentEntityId:'',geometryVersions:[{versionId:'v1',validFrom:null,validTo:null,geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},custom:'kept'}],sourceInfo:{title:'source',custom:'kept'}});
function fixture(edit=()=>{}){
 const stores={},reads=[];
 const put=(rev,p,value,{encoding='gzip',format=false}={})=>{
  const s=stores[rev],a=JSON.parse(s['archive/index.json']),b=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,format?2:undefined)),sha256=hash(b),stored='archive/blobs/'+sha256+(encoding==='gzip'?'.gz':'.bin');
  a.files[p]={stored,encoding,sha256,bytes:b.length};s[stored]=encoding==='gzip'?gzipSync(b):b;s['archive/index.json']=bytes(a);return a.files[p];
 };
 for(const rev of [baselineRevision,revision]){
  stores[rev]={'archive/index.json':bytes({schemaVersion:1,files:{}}),'library.json':Buffer.from('retired, unreadable manifest'),'objects/retired.json':Buffer.from('retired, unreadable object')};
  const e=raw();if(rev===revision)edit(e);put(rev,BASE+'countries/'+e.entityId.replace(':','-')+'.json',e);
 }
 const readBlob=(rev,p)=>{reads.push([rev,p]);if(!stores[rev][p])throw Error('missing '+p);return stores[rev][p];};
 const run=(options={})=>inspectCanonicalInputs({revision,baselineRevision,readBlob,...options});
 return {stores,put,reads,run,readBlob};
}
const country=BASE+'countries/state-AAA.json',world=BASE+'views/world.json';
test('source-only edit is accepted without reading legacy manifests or generated chunks',()=>{
 const f=fixture(e=>e.names.en='B'),r=f.run();
 assert.deepEqual(r.changedEntityIds,['state:AAA']);assert.equal(r.requiredFamilies.length,8);
 assert.equal(r.writes[0].path,country);const e=JSON.parse(r.writes[0].bytes);
 assert.equal(e.names.en,'B');assert.equal(e.sourceInfo.custom,'kept');assert.equal(e.geometryVersions[0].custom,'kept');
 assert.equal(f.reads.some(([,p])=>p==='library.json'||p.startsWith('objects/')),false);
});
test('unchanged sources noop and report-only revisions preserve fingerprint',()=>{
 const f=fixture(),before=f.run();f.put(revision,'reports/run.json',{log:'report'});const after=f.run();
 assert.equal(after.noop,true);assert.deepEqual(after.writes,[]);assert.equal(before.inputFingerprint,after.inputFingerprint);
});
for(const key of ['entityId','entityKind','lineageId','parentEntityId','lifetime'])test('automatic input retains identity policy '+key,()=>{
 assert.throws(()=>fixture(e=>{e[key]=key==='lifetime'?{validFrom:'2000',validTo:null}:key==='entityId'?'state:BBB':key==='entityKind'?'regional':'other';}).run());
});
test('geometry edit preserves exact coordinates and metadata',()=>{
 const r=fixture(e=>e.geometryVersions[0].geometry.coordinates[0][1][0]=1.1234567890123457).run(),e=JSON.parse(r.writes[0].bytes);
 assert.equal(e.geometryVersions[0].geometry.coordinates[0][1][0],1.1234567890123457);assert.equal(e.geometryVersions[0].custom,'kept');
});
for(const mutate of [e=>e.surprise=true,e=>e.schemaVersion=1,e=>e.geometryVersions=[],e=>e.geometryVersions.push(structuredClone(e.geometryVersions[0]))])test('invalid source schema or duplicate version fails before emission',()=>assert.throws(()=>fixture(mutate).run()));
test('filename identity mismatch fails',()=>{
 const f=fixture(),a=JSON.parse(f.stores[revision]['archive/index.json']);a.files[BASE+'countries/state-WRONG.json']=a.files[country];delete a.files[country];
 for(const rev of [baselineRevision,revision])f.stores[rev]['archive/index.json']=bytes(a);
 assert.throws(f.run,/ENTITY_ID_MISMATCH/);
});
for(const kind of ['path','gzip','hash','bytes','encoding'])test('archive '+kind+' corruption is rejected',()=>{
 const f=fixture(),s=f.stores[revision],a=JSON.parse(s['archive/index.json']),d=a.files[country];
 if(kind==='path')d.stored='../escape';else if(kind==='gzip')s[d.stored]=Buffer.from('bad');else if(kind==='hash')d.sha256='c'.repeat(64);else if(kind==='bytes')d.bytes++;else d.encoding='unknown';
 s['archive/index.json']=bytes(a);assert.throws(f.run);
});
for(const added of [true,false])test('automatic source membership changes fail: '+added,()=>{
 const f=fixture();if(added)f.put(revision,BASE+'countries/state-BBB.json',{...raw(),entityId:'state:BBB'});
 else{const a=JSON.parse(f.stores[revision]['archive/index.json']);delete a.files[country];f.stores[revision]['archive/index.json']=bytes(a);}
 assert.throws(f.run);
});
test('retired native and generated index mutations cannot override authoritative source',()=>{
 const f=fixture(e=>e.names.en='source');f.stores[revision]['library.json']=bytes({entities:{evil:'ignored'}});f.stores[revision]['objects/retired.json']=bytes({names:{en:'wrong'}});
 assert.equal(JSON.parse(f.run().writes[0].bytes).names.en,'source');
});
test('format-only source is semantic noop with a distinct content fingerprint',()=>{
 const f=fixture(),before=f.run().inputFingerprint;f.put(revision,country,raw(),{format:true});
 assert.equal(f.run().noop,true);assert.notEqual(f.run().inputFingerprint,before);
});
test('transport-only archive changes preserve fingerprint',()=>{
 const f=fixture(),before=f.run().inputFingerprint;f.put(revision,country,raw(),{encoding:'identity'});
 assert.equal(f.run().noop,true);assert.equal(f.run().inputFingerprint,before);
});
test('unchanged scoped sources are metadata leaves; missing unselected blobs are not repaired',()=>{
 const f=fixture();for(const rev of [baselineRevision,revision])delete f.stores[rev][JSON.parse(f.stores[rev]['archive/index.json']).files[country].stored];
 const r=f.run({changedPaths:[]});assert.equal(r.noop,true);assert.deepEqual(r.inspectedEntityIds,[]);assert.deepEqual(f.reads.map(([,p])=>p),['archive/index.json','archive/index.json']);
});
for(const missing of [false,true])test('same-address changed source cannot evade scoped verification: '+missing,()=>{
 const f=fixture(),p=JSON.parse(f.stores[revision]['archive/index.json']).files[country].stored;
 if(missing)delete f.stores[revision][p];else f.stores[revision][p]=Buffer.from('tampered');
 assert.throws(()=>f.run({changedPaths:[p]}));
});
test('source change is inspected even when trusted diff contains only archive metadata',()=>assert.deepEqual(fixture(e=>e.names.en='changed').run({changedPaths:[]}).changedEntityIds,['state:AAA']));
test('receipt fingerprint survives storage of emitted normalized source bytes',()=>{
 const f=fixture(e=>e.names.en='B'),before=f.run();f.put(revision,country,before.writes[0].bytes);const after=f.run();
 assert.equal(after.inputFingerprint,before.inputFingerprint);assert.deepEqual(after.changedEntityIds,before.changedEntityIds);
});
function withWorld(f,edit=()=>{}){
 for(const rev of [baselineRevision,revision]){const v={schemaVersion:1,id:'world:catalog',selections:[{entityId:'state:AAA',geometryVersionId:'v1'}]};if(rev===revision)edit(v);f.put(rev,world,v);}return f;
}
test('world source edit emits full descriptor and downstream families without native projection',()=>{
 const r=withWorld(fixture(),v=>v.name='new').run();assert.equal(r.viewChanged,true);assert.equal(r.requiredFamilies.length,8);assert.equal(JSON.parse(r.writes[0].bytes).name,'new');assert.equal(r.writes[0].path,world);
});
for(const mutate of [v=>v.selections[0].geometryVersionId='missing',v=>v.selections[0].entityId='state:missing',v=>v.selections.push(v.selections[0]),v=>v.id='old-format',v=>v.schemaVersion=2])test('world source rejects invalid identity or geometry reference',()=>assert.throws(()=>withWorld(fixture(),mutate).run()));
test('missing paired world descriptor fails',()=>{const f=withWorld(fixture());const a=JSON.parse(f.stores[revision]['archive/index.json']);delete a.files[world];f.stores[revision]['archive/index.json']=bytes(a);assert.throws(f.run,/MISSING_ARCHIVE_SOURCE/);});
for(const logical of ['unknown/input.json','assets/data/hydro/lakes_base.geojson','assets/data/places/reviewed-records-v1.json','assets/data/terrain/land.json',BASE+'lineages/aaa.json',BASE+'snapshots/old.json'])test('unsupported archive authority cannot be accepted as generated: '+logical,()=>{
 const f=fixture();f.put(revision,logical,{changed:true});assert.throws(()=>f.run({verifiedGeneratedPaths:[logical]}),/UNSUPPORTED_ARCHIVE_INPUT/);
});
test('trusted exact generated outputs allow generated-only recovery',()=>{
 const f=fixture(),p='assets/data/builtin-world/generated/v1/index.json';f.put(revision,p,{generated:true});const r=f.run({verifiedGeneratedPaths:[p]});assert.equal(r.noop,true);assert.deepEqual(r.generatedChanges,[p]);
 assert.throws(f.run,/UNSUPPORTED_ARCHIVE_INPUT/);
});
for(const paths of [['../bad'],['assets/data/*'],['assets/data/'],['/absolute'],['assets/data/a','assets/data/a'],'not-an-array'])test('trusted output paths must be exact safe identities',()=>assert.throws(()=>fixture().run({verifiedGeneratedPaths:paths})));
for(const options of [{revision:'0'.repeat(40)},{baselineRevision:'bad'},{changedPaths:42},{readBlob:()=>Buffer.alloc(32*1024*1024+1)}])test('invalid immutable input or oversize bytes fails',()=>assert.throws(()=>fixture().run(options)));
