// Finite synthetic repositories exercise the production pinned-evidence reader.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {fixture} from './library-initial-prepared-append.test.mjs';
import {base,hash,json} from './library-detached-component-append.test.mjs';
import {encodeTerritorialSource,decodeTerritorialSource} from '../../../tools/data/territorial-source-codec.mjs';
import {prepareLibraryData,withLibraryWrite} from '../../../tools/data/library-runtime.mjs';
import {storeLibraryData} from '../../../tools/data/library-store.mjs';
import {decodeArchiveEntry,libraryCheckout} from '../../../tools/data/library-context.mjs';
const SOURCE=base+'countries/state-AAA.json',GENERATED=base.replace('/source/','/generated/v2/')+'index.json';
const put=(root,p,b)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b);};
const git=(root,...args)=>execFileSync('git',['-c','core.autocrlf=false',...args],{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
function isolated(t,{omitPinned=false,mutateAfterPin,rawFileOnly=false}={}){
 for(const k of ['PANDOLAB_LIBRARY_DATA_ROOT','GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE'])assert(!process.env[k],'unset '+k+' for isolated store');
 const parent=fs.mkdtempSync(path.join(tmpdir(),'pando-initial-append-')),root=path.join(parent,'app'),data=path.join(root,'.library-data/repository');
 t.after(()=>{const p=path.resolve(parent);assert(p.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(p).startsWith('pando-initial-append-'));fs.rmSync(p,{recursive:true,force:true});});
 for(const dir of [root,data]){fs.mkdirSync(dir,{recursive:true});git(dir,'init','-q');git(dir,'config','core.longpaths','true');git(dir,'config','user.name','Fixture');git(dir,'config','user.email','fixture@example.invalid');}
 assert.equal(path.resolve(libraryCheckout(root)),path.resolve(data));
 const files={},add=(p,b)=>{put(data,p,b);files[p]={stored:p,encoding:'identity',sha256:hash(b),bytes:b.length};},commit=m=>{put(data,'archive/index.json',json({schema:'pando-library-archive-v1',files}));git(data,'add','.');git(data,'commit','-qm',m);return git(data,'rev-parse','HEAD');};
 const f=fixture();for(const [p,b]of f.sourceMap)add(p,b);add(GENERATED,json({entities:[]}));if(!omitPinned)for(const [p,b]of f.pinned)add(p,b);const pin=commit('immutable prepared source and scope anchors');
 f.authority.sourcePin=f.authority.archiveRevision=f.scope.revision=f.universe.revision=pin;mutateAfterPin?.(f);f.refresh();for(const [p,b]of f.evidence)if(!rawFileOnly||!f.pinned.has(p))add(p,b);commit('new source-only append proof');
 const head=git(data,'rev-parse','HEAD');put(root,'config/library-data.json',json({repository:'fixture/data',revision:pin,mounts:['assets/data','reports']}));put(root,'.gitignore','.library-data/\nassets/data/\nreports/\n');git(root,'add','.');git(root,'commit','-qm','fixture config');
 prepareLibraryData({root,fetch:false,purpose:'gis',prefixes:[base+'countries',base+'geometries',GENERATED]});
 if(rawFileOnly){for(const [p,b]of f.pinned)put(root,p,b);fs.appendFileSync(path.join(data,'.git/info/exclude'),'\n'+[...f.pinned.keys()].map(p=>'/'+p).join('\n')+'\n');assert.equal(git(data,'status','--porcelain'),'');}
 const index=fs.readFileSync(path.join(data,'archive/index.json')),config=fs.readFileSync(path.join(root,'config/library-data.json')),enc=encodeTerritorialSource(f.next);
 withLibraryWrite({root,prefixes:f.prefixes},()=>{put(root,SOURCE,json(enc.descriptor));for(const [p,b]of enc.geometries)put(root,base+p,b);});
 return {f,root,data,pin,head,index,config,store:()=>storeLibraryData({root,prefixes:f.prefixes,push:false}),read:(p,rev)=>{const i=JSON.parse(git(data,'show',rev+':archive/index.json'));return decodeArchiveEntry(data,i.files[p],rev,{fetch:false});}};
}
const rejected=(s,pattern)=>{assert.throws(s.store,pattern);assert.equal(git(s.data,'rev-parse','HEAD'),s.head);assert.deepEqual(fs.readFileSync(path.join(s.data,'archive/index.json')),s.index);assert.deepEqual(fs.readFileSync(path.join(s.root,'config/library-data.json')),s.config);};
test('initial prepared actual store uses pinned anchors and writes exactly two source paths',t=>{const s=isolated(t),rev=s.store(),after=JSON.parse(git(s.data,'show',rev+':archive/index.json')),before=JSON.parse(s.index);assert.notEqual(rev,s.head);assert.deepEqual(Object.keys(after.files).filter(p=>JSON.stringify(after.files[p])!==JSON.stringify(before.files[p])).sort(),s.f.prefixes.slice().sort());assert(Object.keys(before.files).every(p=>after.files[p]));assert.deepEqual(decodeTerritorialSource(JSON.parse(s.read(SOURCE,rev)),p=>s.read(base+p,rev)),s.f.next);assert.equal(JSON.parse(fs.readFileSync(path.join(s.root,'config/library-data.json'))).revision,rev);});
test('initial prepared actual store rejects anchors first introduced after source pin',t=>{const s=isolated(t,{omitPinned:true});rejected(s,/pinned.*(?:missing|absent)|(?:missing|absent).*pinned|absent or different at source pin/i);});
test('initial prepared actual store does not substitute report HEAD for a different pinned anchor',t=>{const s=isolated(t,{mutateAfterPin:f=>{f.originalAnchor.rows[0].originalFeatures[0].name='rewritten after pin';}});rejected(s,/absent or different at source pin/);});
test('initial prepared actual store never falls back to a mutable raw report file',t=>{const s=isolated(t,{omitPinned:true,rawFileOnly:true});rejected(s,/pinned.*(?:missing|absent)|(?:missing|absent).*pinned|Missing archived source adoption evidence|absent or different at source pin/i);});
