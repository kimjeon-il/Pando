import {execFileSync} from 'node:child_process';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
import {inspectRawCoastStore,storeRawCoastData} from '../../../tools/data/library-raw-coast-store.mjs';
import {planRawCoastStore} from '../../../tools/data/library-raw-coast-plan.mjs';
import test from'node:test';import assert from'node:assert/strict';import{createHash}from'node:crypto';import{assertRetainedCoast,replayRetainedCoast,exactCyclicChain,retainedCoastMethod as method,retainedCoastRelation as result}from'../../../tools/gis/retained-coast-source-review.mjs';import{encodeTerritorialSource}from'../../../tools/data/territorial-source-codec.mjs';import{buildChunkedBlobEvidence}from'../../../tools/data/chunked-original-source.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),digest=g=>hash(JSON.stringify([g.type,g.coordinates])),base='assets/data/territorial-entities/source/',status='raw-source-only-not-display-approved',topology={status:'deferred-until-complete-modern-replacement',displayApproved:false},geometry=r=>({type:'MultiPolygon',coordinates:[[r]]});
function blob(g){const r=g.coordinates[0][0],w=Buffer.alloc(22+r.length*16);w[0]=1;w.writeUInt32LE(6,1);w.writeUInt32LE(1,5);w[9]=1;w.writeUInt32LE(3,10);w.writeUInt32LE(1,14);w.writeUInt32LE(r.length,18);r.forEach(([x,y],i)=>{w.writeDoubleLE(x,22+16*i);w.writeDoubleLE(y,30+16*i);});const h=Buffer.alloc(40);h.set([71,80,0,3]);h.writeInt32LE(4326,4);[Math.min(...r.map(p=>p[0])),Math.max(...r.map(p=>p[0])),Math.min(...r.map(p=>p[1])),Math.max(...r.map(p=>p[1]))].forEach((x,i)=>h.writeDoubleLE(x,8+8*i));return Buffer.concat([h,w]);}
function fixture(proofPrefix=''){const oldg=geometry([[0,0],[2,0],[2,2],[0,2],[0,0]]),raw=geometry([[0,0],[1,-.1],[2,0],[2,2],[0,2],[0,0]]),archive=new Map(),put=(p,x)=>{if(proofPrefix)p=proofPrefix+p.slice(8);const b=Buffer.from(JSON.stringify(x)+'\n');archive.set(p,b);return{reference:p,sha256:hash(b)};};const entity=(code,g)=>({schemaVersion:2,entityId:'state:'+code,parentEntityId:'',names:{ko:code},lifetime:{validFrom:'1948',validTo:null},sourceInfo:{sourceId:'keep-source',title:'keep-title',geometryVersionId:code+'-current'},metadata:{retain:'policy'},geometryVersions:[{versionId:code+'-history',validFrom:'1948-01-01',validTo:'1953-07-26',geometry:structuredClone(oldg),sourceId:'old-source',historicalProvenance:{retain:'unverified historical proxy'}},{versionId:code+'-current',validFrom:'1953-07-27',validTo:null,sourceId:'keep-version-source',geometry:g,historicalProvenance:{retain:'selected policy'},modernBoundarySupplement:{retain:'prior'}}]});const previous=entity('KOR',oldg),peer=entity('PRK',geometry([[0,2],[2,2],[2,3],[0,3],[0,2]])),next=structuredClone(previous),v=next.geometryVersions[1];v.geometry=raw;const policy={schemaVersion:1,method:'existing-political-partition-coast-only',rows:[]};for(const e of[previous,peer]){const p=base+'countries/'+e.entityId.replace(':','-')+'.json',enc=encodeTerritorialSource(e),b=Buffer.from(JSON.stringify(enc.descriptor));archive.set(p,b);for(const[p,b]of enc.geometries)archive.set(base+p,b);policy.rows.push({code:e.entityId.slice(6),descriptorPath:p,descriptorSha256:hash(b),versionId:e.geometryVersions[1].versionId,validFrom:'1953-07-27',validTo:null,geometrySha256:digest(e.geometryVersions[1].geometry)});}
 const b=blob(raw),id='c1feb3b8-ed1a-4882-95bb-e8f1def554f0',source={schemaVersion:1,method:'exact-gpkg-original-feature',sourcePath:'verified.gpkg',sourceFileReceipt:{gpkgSha256:'55fab422ef09e35eb48d68141b9ece0ace86d4276dfe332a04dfd401c0bfc80c'},featureId:id,properties:{WP_ID:id,GENC_3:'KOR'},rawBlobBase64:b.toString('base64'),rawBlobSha256:hash(b),rawWkbSha256:hash(b.subarray(40)),geometry:raw};
 const r={schemaVersion:1,method,status,resultRelation:result,entityId:'state:KOR',versionId:'KOR-current',validFrom:'1953-07-27',validTo:null,previousDescriptorSha256:policy.rows[0].descriptorSha256,previousGeometrySha256:digest(oldg),operations:[{polygonIndex:0,ringIndex:0,startIndex:0,endIndex:1,raw:{polygonIndex:0,ringIndex:0,startIndex:0,endIndex:2,direction:1}}],ringStarts:[{polygonIndex:0,ringIndex:0,startIndex:0}]},batch={schemaVersion:1,method,resultRelation:result,topology,members:[{entityId:'state:KOR',descriptor:policy.rows[0].descriptorPath,previousDescriptorSha256:r.previousDescriptorSha256}]};v.modernBoundarySupplement={adoptionMode:method,status,resultRelation:result,wholeCountryRaw:false,topology,priorPreparedAttribution:structuredClone(previous.geometryVersions[1].modernBoundarySupplement)};
 const f={previous,next,peer,source,policy,r,batch,archive,prefixes:[],seal(){r.geometrySha256=digest(v.geometry);r.geometryResourceSha256=hash(JSON.stringify(v.geometry)+'\n');v.modernBoundarySupplement.geometrySha256=r.geometrySha256;next.sourceInfo.geometrySha256=r.geometrySha256;policy.rows[0].candidateGeometrySha256=r.geometrySha256;r.source=put('reports/raw.json',source);policy.rows[0].operations=structuredClone(r.operations);policy.rows[0].ringStarts=structuredClone(r.ringStarts);policy.rows[0].source=r.source;r.policy=put('reports/policy.json',policy);batch.members[0].resource=base+'geometries/sha256-'+r.geometryResourceSha256+'.json';r.batch=put('reports/batch.json',batch);v.modernBoundarySupplement.retainedCoastReview=put('reports/review.json',r);f.prefixes=[batch.members[0].descriptor,batch.members[0].resource];return f;},run(){f.seal();return assertRetainedCoast(next,previous,{prefixes:f.prefixes,readEvidence:p=>archive.get(p)});}};return f.seal();}
test('selected dated coast changes, historical geometry and source attribution preserved',()=>{const f=fixture();assert.equal(f.run(),1);assert.deepEqual(f.next.geometryVersions[0],f.previous.geometryVersions[0]);});
for(const[name,mutate]of Object.entries({'sourceId':f=>f.next.sourceInfo.sourceId='wrong','title':f=>f.next.sourceInfo.title='wrong','version source':f=>f.next.geometryVersions[1].sourceId='wrong','identity':f=>f.next.entityId='state:CYP','parent':f=>f.next.parentEntityId='state:OTHER','date':f=>f.next.geometryVersions[1].validFrom='1801-01-01','history coordinates':f=>f.next.geometryVersions[0].geometry.coordinates[0][0][1][0]=3,'history provenance':f=>f.next.geometryVersions[0].historicalProvenance={wrong:true},'prior supplement':f=>f.next.geometryVersions[1].modernBoundarySupplement.priorPreparedAttribution={},'single-original claim':f=>f.next.geometryVersions[1].modernBoundarySupplement.wholeCountryRaw=true,'display claim':f=>f.next.geometryVersions[1].modernBoundarySupplement.topology={status:'passed',displayApproved:true},'actual preimage':f=>f.r.previousDescriptorSha256='a'.repeat(64),'policy preimage':f=>f.policy.rows[1].descriptorSha256='a'.repeat(64),'policy member':f=>f.policy.rows.pop(),'policy historical selection':f=>f.policy.rows[1].versionId='PRK-history','wrong raw feature':f=>f.source.featureId='wrong','wrong raw code':f=>f.source.properties.GENC_3='CYP','wrong official source':f=>f.source.sourceFileReceipt.gpkgSha256='a'.repeat(64),'corrupt blob':f=>f.source.rawBlobBase64='AA==','wrong WKB':f=>f.source.rawWkbSha256='a'.repeat(64),'wrong raw range':f=>f.r.operations[0].raw.endIndex=3,'wrong target endpoint':f=>f.r.operations[0].endIndex=2,'nonselected coordinate':f=>f.next.geometryVersions[1].geometry.coordinates[0][0][3][0]=3,'duplicate operation':f=>f.r.operations.push(structuredClone(f.r.operations[0])),'full ring raw':f=>f.r.operations[0].raw.endIndex=0,'invalid raw direction':f=>f.r.operations[0].raw.direction=0,'output rotation wrong':f=>f.r.ringStarts[0].startIndex=1,'unexpected batch member':f=>f.batch.members.push({entityId:'state:SPI'})}))test('rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>f.run());});
test('broad write prefix rejected',()=>{const f=fixture();assert.throws(()=>assertRetainedCoast(f.next,f.previous,{prefixes:[...f.prefixes,base+'countries/state-PRK.json'],readEvidence:p=>f.archive.get(p)}));});
test('chunked original is exact same semantics',()=>{const f=fixture(),parts=buildChunkedBlobEvidence(Buffer.from(f.source.rawBlobBase64,'base64'),{prefix:'reports/chunks/',chunkBytes:100});delete f.source.geometry;delete f.source.rawBlobBase64;Object.assign(f.source,parts.manifest);for(const[p,b]of parts.files)f.archive.set(p,b);assert.equal(f.run(),1);});
test('raw cyclic directions and wrap are exact, without duplicated ring closure',()=>{const r=[[0,0],[2,0],[2,2],[0,2],[0,0]];assert.deepEqual(exactCyclicChain(r,3,1),[[0,2],[0,0],[2,0]]);assert.deepEqual(exactCyclicChain(r,1,3,-1),[[2,0],[0,0],[0,2]]);assert.throws(()=>exactCyclicChain(r,4,1));});
test('target wrap with explicit retained output anchor',()=>{const old=geometry([[0,0],[2,0],[2,2],[0,2],[0,0]]),raw=geometry([[0,2],[-.1,1],[2,0],[2,2],[0,2]]),op={polygonIndex:0,ringIndex:0,startIndex:3,endIndex:1,raw:{polygonIndex:0,ringIndex:0,startIndex:0,endIndex:2,direction:1}};const out=replayRetainedCoast(old,raw,[op],[{polygonIndex:0,ringIndex:0,startIndex:1}]);assert.deepEqual(out.coordinates[0][0],[[2,0],[2,2],[0,2],[-.1,1],[2,0]]);assert.throws(()=>replayRetainedCoast(old,raw,[op],[{polygonIndex:0,ringIndex:0,startIndex:0}]),/retained exact old anchor/);});
test('Polygon type and unchanged interior rings preserved',()=>{const old={type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]],[[.5,.5],[.5,1],[1,1],[.5,.5]]]},raw=geometry([[0,0],[1,-.1],[2,0],[2,2],[0,2],[0,0]]),out=replayRetainedCoast(old,raw,[{polygonIndex:0,ringIndex:0,startIndex:0,endIndex:1,raw:{polygonIndex:0,ringIndex:0,startIndex:0,endIndex:2,direction:1}}],[{polygonIndex:0,ringIndex:0,startIndex:0}]);assert.equal(out.type,'Polygon');assert.deepEqual(out.coordinates[1],old.coordinates[1]);});
for(const key of ['operations','ringStarts','source'])test('fixed reviewed policy '+key+' cannot be replaced',()=>{const f=fixture();f.policy.rows[0][key]=key==='source'?{reference:'reports/other.json',sha256:'a'.repeat(64)}:[];const b=Buffer.from(JSON.stringify(f.policy)+'\n');f.archive.set('reports/policy.json',b);f.r.policy.sha256=hash(b);const rb=Buffer.from(JSON.stringify(f.r)+'\n');f.archive.set('reports/review.json',rb);f.next.geometryVersions[1].modernBoundarySupplement.retainedCoastReview.sha256=hash(rb);assert.throws(()=>assertRetainedCoast(f.next,f.previous,{prefixes:f.prefixes,readEvidence:p=>f.archive.get(p)}),/policy candidate binding/);});
test('original raw line cannot replace protected peer boundary even with exact endpoints',()=>{const f=fixture(),g=geometry([[0,0],[1,-.1],[2,0],[2,2],[1,2.1],[0,2],[0,0]]);f.source.geometry=g;f.next.geometryVersions[1].geometry=g;const b=blob(g);f.source.rawBlobBase64=b.toString('base64');f.source.rawBlobSha256=hash(b);f.source.rawWkbSha256=hash(b.subarray(40));f.r.operations.push({polygonIndex:0,ringIndex:0,startIndex:2,endIndex:3,raw:{polygonIndex:0,ringIndex:0,startIndex:3,endIndex:5,direction:1}});assert.throws(()=>f.run(),/political boundary edges changed/);});

test('cyclic ring rejects latitude outside 90 degrees and longitude outside 180',()=>{for(const r of [[[0,91],[1,91],[1,92],[0,91]],[[181,0],[182,0],[182,1],[181,0]]])assert.throws(()=>exactCyclicChain(r,0,1),/finite closed 2D ring/);});

const coastSourceRevision='b'.repeat(40);
const coastEvidencePrefix='reports/borders/validation/modern-raw-source-20261110/synthetic-coast/';
function coastStoreFixture(){
  const f=fixture(coastEvidencePrefix);
  const {descriptor,geometries}=encodeTerritorialSource(f.next);
  const updates=new Map([[f.prefixes[0],Buffer.from(JSON.stringify(descriptor)+'\n')],[f.prefixes[1],geometries.get(f.prefixes[1].slice(base.length))]]);
  const proofs=new Map([...f.archive].filter(([path])=>path.startsWith(coastEvidencePrefix)));
  const pinned=new Map([...f.archive].filter(([path])=>!proofs.has(path)));
  const unrelatedPath='assets/data/unselected/keep.json',unrelated=Buffer.from('{"keep":true}\n');
  pinned.set(unrelatedPath,unrelated);
  const files=Object.fromEntries([...pinned].map(([path,bytes])=>[path,{stored:path,encoding:'identity',sha256:hash(bytes),bytes:bytes.length}]));
  const index={schemaVersion:1,branch:'work/gis-raw-modern',sourceRevision:'a'.repeat(40),reportLayout:'subjects-v1',files};
  pinned.set('archive/index.json',Buffer.from(JSON.stringify(index)+'\n'));
  const readStored=path=>pinned.get(path)??null;
  return {args:{index,readStored,updates,proofs,sourceRevision:coastSourceRevision},f,pinned,unrelatedPath};
}
test('raw coast planner writes only the admitted current descriptor, CAS and consumed evidence',()=>{
  const {args,pinned,unrelatedPath}=coastStoreFixture(),plan=planRawCoastStore(args);
  const read=path=>plan.paths.get(path)??pinned.get(path)??null;
  assert.equal(plan.paths.size,1+args.updates.size+args.proofs.size);
  assert.equal(plan.verify(read),true);
  const next=JSON.parse(read('archive/index.json'));
  assert.equal(next.sourceRevision,coastSourceRevision);
  assert.deepEqual(next.files[unrelatedPath],args.index.files[unrelatedPath]);
  assert(!plan.paths.has(unrelatedPath));
  for(const path of args.proofs.keys())assert.deepEqual(plan.paths.get(path),args.proofs.get(path));
  const descriptor=[...args.updates.keys()][0],stored=next.files[descriptor].stored;
  assert.throws(()=>plan.verify(path=>path===stored?Buffer.from('damaged'):read(path)));
});
test('raw coast planner rejects another branch, unrelated writes, and a missing exact scope member',()=>{
  const {args}=coastStoreFixture(),[descriptor]=args.updates.keys();
  assert.throws(()=>planRawCoastStore({...args,index:{...args.index,branch:'main'}}),/raw revision/);
  const extra=new Map(args.updates);extra.set('assets/data/world/current.json',Buffer.from('{}'));
  assert.throws(()=>planRawCoastStore({...args,updates:extra}),/invalid or duplicate source file/);
  assert.throws(()=>planRawCoastStore({...args,updates:new Map([[descriptor,args.updates.get(descriptor)]])}),/missing pinned archive entry/);
});
test('raw coast planner refuses proof overwrite, unused proof and changed immutable evidence',()=>{
  const {args,pinned}=coastStoreFixture();
  const extra=new Map(args.proofs);extra.set(coastEvidencePrefix+'unsolicited.json',Buffer.from('{}'));
  assert.throws(()=>planRawCoastStore({...args,proofs:extra}),/new evidence must be used/);
  const path=coastEvidencePrefix+'review.json',changed=new Map(args.proofs);changed.set(path,Buffer.from('{}'));
  assert.throws(()=>planRawCoastStore({...args,proofs:changed}),/archived receipt mismatch/);
  pinned.set(path,args.proofs.get(path));
  assert.throws(()=>planRawCoastStore(args),/cannot replace existing evidence/);
});
test('raw coast planner rejects metadata-only changes and immutable storage collisions',()=>{
  const {args,pinned}=coastStoreFixture(),[path]=args.updates.keys(),updates=new Map(args.updates);
  const nochange=JSON.parse(pinned.get(path)),candidate=JSON.parse(updates.get(path));
  nochange.geometryVersions[1].modernBoundarySupplement=candidate.geometryVersions[1].modernBoundarySupplement;
  nochange.names.ko='not a coastline change';
  updates.set(path,Buffer.from(JSON.stringify(nochange)));
  assert.throws(()=>planRawCoastStore({...args,updates}),/unchanged or unknown coordinate version/);
  const plan=planRawCoastStore(args),next=JSON.parse(plan.paths.get('archive/index.json'));
  pinned.set(next.files[path].stored,Buffer.from('different'));
  assert.throws(()=>planRawCoastStore(args),/immutable archive output collision/);
});


function pairedCoastFixture(t){
  const sandbox=mkdtempSync(join(realpathSync.native(tmpdir()),'pando-raw-coast-fixture-'));
  const app=join(sandbox,'app'),library=join(sandbox,'library'),mount=join(app,'.library-data','repository');
  t.after(()=>{
    const parent=realpathSync.native(tmpdir());
    assert.equal(dirname(realpathSync.native(sandbox)),parent);
    assert.match(basename(sandbox),/^pando-raw-coast-fixture-/);
    if(lstatSync(mount,{throwIfNoEntry:false})?.isSymbolicLink())unlinkSync(mount);
    rmSync(sandbox,{recursive:true});
  });
  const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{stdio:['ignore','pipe','pipe']});
  const tell=(repo,...args)=>git(repo,...args).toString().trim();
  const head=repo=>tell(repo,'rev-parse','HEAD'), raw=repo=>tell(repo,'rev-parse','refs/heads/work/gis-raw-modern');
  function init(repo){
    mkdirSync(repo);
    git(repo,'init','--initial-branch=main');
    git(repo,'config','user.name','Pando coast fixture');
    git(repo,'config','user.email','coast-test@localhost');
    git(repo,'config','core.autocrlf','false');
  }
  function write(repo,path,value){const file=join(repo,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,value);}
  function commit(repo){git(repo,'add','--all');git(repo,'commit','-m','initial fixture');}
  function branch(repo){
    const revision=tell(repo,'commit-tree',tell(repo,'rev-parse','HEAD^{tree}'),'-p',head(repo),'-m','raw fixture root');
    git(repo,'update-ref','refs/heads/work/gis-raw-modern',revision,'0'.repeat(40));
    return revision;
  }
  const {args,pinned}=coastStoreFixture();
  init(library);
  for(const [path,bytes]of pinned)write(library,path,bytes);
  commit(library);
  const expectedDataRevision=branch(library);
  init(app);
  write(app,'.gitignore','/.library-data/\n');
  const pin={schemaVersion:1,repository:'kimjeon-il/PandoLab-library',revision:expectedDataRevision,mounts:['assets/data','reports']};
  write(app,'config/library-data.json',JSON.stringify(pin,null,2)+'\n');
  commit(app);
  const expectedAppRevision=branch(app);
  mkdirSync(dirname(mount));
  symlinkSync(library,mount,process.platform==='win32'?'junction':'dir');
  const status=repo=>tell(repo,'--no-optional-locks','status','--porcelain=v1','--untracked-files=all');
  const snapshot=()=>[app,library].map(repo=>({
    head:head(repo),main:tell(repo,'rev-parse','refs/heads/main'),index:readFileSync(join(repo,'.git','index')),
    status:status(repo),refs:tell(repo,'for-each-ref','--format=%(refname)'),
  }));
  return {app,library,git,tell,raw,snapshot,
    options:{root:app,expectedAppRevision,expectedDataRevision,updates:args.updates,proofs:args.proofs}};
}
test('raw coast store advances only paired raw refs and binds the app pin to verified data',t=>{
  const f=pairedCoastFixture(t),before=f.snapshot(),preview=inspectRawCoastStore(f.options);
  assert.deepEqual(preview.blockedBy,[]);
  assert.equal(preview.paths.length,1+f.options.updates.size+f.options.proofs.size);
  const result=storeRawCoastData(f.options);
  assert.notEqual(result.appRevision,f.options.expectedAppRevision);
  assert.notEqual(result.dataRevision,f.options.expectedDataRevision);
  assert.equal(f.raw(f.app),result.appRevision);
  assert.equal(f.raw(f.library),result.dataRevision);
  assert.equal(f.tell(f.app,'rev-parse',result.appRevision+'^'),f.options.expectedAppRevision);
  assert.equal(f.tell(f.library,'rev-parse',result.dataRevision+'^'),f.options.expectedDataRevision);
  assert.equal(JSON.parse(f.git(f.app,'show',result.appRevision+':config/library-data.json')).revision,result.dataRevision);
  assert.equal(JSON.parse(f.git(f.library,'show',result.dataRevision+':archive/index.json')).sourceRevision,f.options.expectedAppRevision);
  assert.deepEqual(f.snapshot(),before);
  const [proof]=f.options.proofs.keys();
  assert.equal(lstatSync(join(f.library,proof),{throwIfNoEntry:false}),undefined);
});
test('pending Git compaction blocks before allocating Git objects or changing either raw ref',t=>{
  const f=pairedCoastFixture(t),before=f.snapshot(),pending=join(f.library,'.git','pando-git-compaction.pending.json');
  writeFileSync(pending,'{}\n');
  const sizes=[f.app,f.library].map(repo=>f.tell(repo,'count-objects','-v'));
  assert.deepEqual(inspectRawCoastStore(f.options).blockedBy,['pending library Git compaction']);
  assert.throws(()=>storeRawCoastData(f.options),/pending library Git compaction/);
  assert.deepEqual([f.app,f.library].map(repo=>f.tell(repo,'count-objects','-v')),sizes);
  assert.equal(f.raw(f.app),f.options.expectedAppRevision);
  assert.equal(f.raw(f.library),f.options.expectedDataRevision);
  assert.deepEqual(f.snapshot(),before);
  assert.equal(readFileSync(pending,'utf8'),'{}\n');
  assert.equal(lstatSync(join(f.library,'.git','pando-library.lock'),{throwIfNoEntry:false}),undefined);
});
