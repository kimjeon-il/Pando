// Actual source-only store boundary, confined to finite synthetic OS-temp repositories.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {fixture,base,hash,json,multi,poly} from './library-detached-component-append.test.mjs';
import {encodeTerritorialSource,decodeTerritorialSource} from '../../../tools/data/territorial-source-codec.mjs';
import {prepareLibraryData,withLibraryWrite} from '../../../tools/data/library-runtime.mjs';
import {storeLibraryData} from '../../../tools/data/library-store.mjs';
import {decodeArchiveEntry,libraryCheckout} from '../../../tools/data/library-context.mjs';
const GENERATED=base.replace('/source/','/generated/v2/')+'index.json',SOURCE=base+'countries/state-AAA.json',SENTINEL='assets/data/detached-sentinel.json';
const put=(root,p,b)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b);};
const git=(root,...args)=>execFileSync('git',['-c','core.autocrlf=false',...args],{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
function isolated(t,{mutate,headChange,omitReview=false,stripReceipt=false}={}){
 for(const k of ['PANDOLAB_LIBRARY_DATA_ROOT','GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE'])assert(!process.env[k],'unset '+k+' for isolated store');
 const parent=fs.mkdtempSync(path.join(tmpdir(),'pando-detached-store-')),root=path.join(parent,'app'),data=path.join(root,'.library-data/repository');
 t.after(()=>{const p=path.resolve(parent);assert(p.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(p).startsWith('pando-detached-store-'));fs.rmSync(p,{recursive:true,force:true});});
 for(const dir of [root,data]){fs.mkdirSync(dir,{recursive:true});git(dir,'init','-q');git(dir,'config','core.longpaths','true');git(dir,'config','user.name','Fixture');git(dir,'config','user.email','fixture@example.invalid');}
 assert.equal(path.resolve(libraryCheckout(root)),path.resolve(data));
 const files={},add=(p,b)=>{put(data,p,b);files[p]={stored:p,encoding:'identity',sha256:hash(b),bytes:b.length};},commit=m=>{put(data,'archive/index.json',json({schema:'pando-library-archive-v1',files}));git(data,'add','.');git(data,'commit','-qm',m);return git(data,'rev-parse','HEAD');};
 const f=fixture();for(const [p,b]of f.sourceMap)add(p,b);add(GENERATED,json({entities:[]}));add(SENTINEL,json({value:0}));const pin=commit('finite source fixture');f.authority.sourcePin=f.authority.archiveRevision=f.scope.revision=f.universe.revision=pin;mutate?.(f);f.refresh();for(const [p,b]of f.evidence)if(!omitReview||!p.endsWith('/review.json'))add(p,b);commit('report-only evidence descendant');
 headChange?.({f,add,commit});const head=git(data,'rev-parse','HEAD');
 put(root,'config/library-data.json',json({repository:'fixture/data',revision:pin,mounts:['assets/data','reports']}));put(root,'.gitignore','.library-data/\nassets/data/\nreports/\n');git(root,'add','.');git(root,'commit','-qm','fixture config');
 prepareLibraryData({root,fetch:false,purpose:'gis',prefixes:[base+'countries',base+'geometries',GENERATED,SENTINEL]});assert.equal(git(data,'status','--porcelain'),'');
 if(stripReceipt)delete f.next.geometryVersions[0].modernBoundarySupplement.sourceAdoptionReview;
 const index=fs.readFileSync(path.join(data,'archive/index.json')),config=fs.readFileSync(path.join(root,'config/library-data.json')),enc=encodeTerritorialSource(f.next);
 withLibraryWrite({root,prefixes:f.prefixes},()=>{put(root,SOURCE,json(enc.descriptor));for(const [p,b]of enc.geometries)put(root,base+p,b);});
 return {f,root,data,pin,head,index,config,store:()=>storeLibraryData({root,prefixes:f.prefixes,push:false}),read:(p,rev)=>{const i=JSON.parse(git(data,'show',rev+':archive/index.json'));return decodeArchiveEntry(data,i.files[p],rev,{fetch:false});}};
}
const rejected=(s,pattern)=>{assert.throws(s.store,pattern);assert.equal(git(s.data,'rev-parse','HEAD'),s.head);assert.deepEqual(fs.readFileSync(path.join(s.data,'archive/index.json')),s.index);assert.deepEqual(fs.readFileSync(path.join(s.root,'config/library-data.json')),s.config);};
test('detached actual store admits exactly two source paths after report-only advance',t=>{const s=isolated(t),rev=s.store(),after=JSON.parse(git(s.data,'show',rev+':archive/index.json')),before=JSON.parse(s.index);assert.notEqual(rev,s.head);const changed=Object.keys(after.files).filter(p=>JSON.stringify(after.files[p])!==JSON.stringify(before.files[p]));assert.deepEqual(changed.sort(),s.f.prefixes.slice().sort());assert(Object.keys(before.files).every(p=>after.files[p]));for(const [p,b]of s.f.sourceMap)assert.deepEqual(s.read(p,s.pin),b);const decoded=decodeTerritorialSource(JSON.parse(s.read(SOURCE,rev)),p=>s.read(base+p,rev));assert.deepEqual(decoded,s.f.next);assert.equal(JSON.parse(fs.readFileSync(path.join(s.root,'config/library-data.json'))).revision,rev);});
test('detached actual store rejects hidden authoritative country',t=>{const s=isolated(t,{headChange:({f,add,commit})=>{const d=JSON.parse(f.sourceMap.get(base+'countries/state-BBB.json'));d.entityId='state:CCC';add(base+'countries/state-CCC.json',json(d));commit('unreviewed country');}});rejected(s,/source pin\/HEAD country sets differ/);});
test('detached actual store rejects rehashed omitted census member',t=>{const s=isolated(t,{mutate:f=>f.universe.countries.pop()});rejected(s,/authoritative census membership mismatch/);});
test('detached actual store rejects fake appended coordinate despite new candidate hash',t=>{const s=isolated(t,{mutate:f=>{f.next.geometryVersions[0].geometry.coordinates[2]=poly(50);}});rejected(s,/exact old prefix plus original arrays/);});

const disguisedNoop=f=>{f.next.geometryVersions[0].geometry=structuredClone(f.before.geometryVersions[0].geometry);delete f.next.geometryVersions[0].modernBoundarySupplement.detachedComponentAppend;f.next.geometryVersions[0].modernBoundarySupplement.adoptionMode='lossless-original-feature';};
test('detached actual store rejects no-op append receipt despite disguised method',t=>{const s=isolated(t,{mutate:disguisedNoop});rejected(s,/unchanged geometry cannot acquire append receipt/);});
test('detached actual store refuses no-op newly issued but unarchived receipt',t=>{const s=isolated(t,{mutate:disguisedNoop,omitReview:true});rejected(s,/Missing archived source adoption evidence/);});

test('detached actual store rejects initial changed geometry with deleted admission receipt',t=>{const s=isolated(t,{stripReceipt:true});rejected(s,/detached-component append: initial append receipt is required/);});
