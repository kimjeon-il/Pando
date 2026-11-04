import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,statSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installFrontendSnapshot,retireFrontendSnapshots} from '../../tools/worktree-storage.mjs';
test('immutable frontend outputs reuse file IDs and resume an interrupted installation',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-frontend-store-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const settings={cacheRoot:join(root,'cache')},app=join(root,'one');mkdirSync(app);
 const snapshot={sourceSha256:'a'.repeat(64),sourceCommit:'b'.repeat(40),dataCommit:'c'.repeat(40),assets:new Map([['index.html',{bytes:Buffer.from('same')}],['assets/a.js',{bytes:Buffer.from('same')}]])};
 assert.throws(()=>installFrontendSnapshot({root:app,snapshot,settings,afterFile(){throw Error('interrupt');}}),/interrupt/);
 const first=installFrontendSnapshot({root:app,snapshot,settings}),second=installFrontendSnapshot({root:app,snapshot,settings});
 assert.equal(first,second);assert.equal(statSync(join(first,'index.html')).ino,statSync(join(first,'assets/a.js')).ino);assert.equal(statSync(join(first,'index.html')).mode&0o200,0);assert.equal(readFileSync(join(first,'index.html'),'utf8'),'same');
});
test('frontend retirement preserves branch references and resumes only verified obsolete views',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-frontend-gc-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const settings={cacheRoot:join(root,'cache')},a=join(root,'a'),b=join(root,'b');mkdirSync(a);mkdirSync(b);
 const snapshot=id=>({sourceSha256:id.repeat(64),sourceCommit:'c'.repeat(40),dataCommit:'d'.repeat(40),assets:new Map([['index.html',{bytes:Buffer.from('shared')}],['assets/a.js',{bytes:Buffer.from('shared')}]])});
 const old=installFrontendSnapshot({root:a,snapshot:snapshot('a'),settings});
 installFrontendSnapshot({root:b,snapshot:snapshot('a'),settings});
 const current=installFrontendSnapshot({root:a,snapshot:snapshot('b'),settings});
 const options={root:a,roots:[a,b],settings,processes:[]};
 assert.equal(retireFrontendSnapshots(options).entries.filter(e=>e.status==='eligible').length,0);
 installFrontendSnapshot({root:b,snapshot:snapshot('b'),settings});
 assert.equal(retireFrontendSnapshots(options).entries.filter(e=>e.status==='eligible').length,1);
 assert.equal(retireFrontendSnapshots({...options,processes:[{Name:'node.exe',CommandLine:'node tests/browser/server.mjs'}]}).entries.filter(e=>e.status==='eligible').length,1);
 assert.equal(retireFrontendSnapshots({...options,processes:[{Name:'node.exe',CommandLine:'preview --assets='+old}]}).entries.find(e=>e.directory===old).status,'referenced');
 assert.throws(()=>retireFrontendSnapshots({...options,apply:true,afterFile(){throw Error('interrupt');}}),/interrupt/);
 const result=retireFrontendSnapshots({...options,apply:true});assert.ok(result.deletedBytes>0);assert.equal(existsSync(old),false);
 assert.equal(readFileSync(join(current,'index.html'),'utf8'),'shared');assert.equal(statSync(join(current,'index.html')).mode&0o200,0);
});

test('frontend write-ahead batches resume missing files once and reject a changed batch',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-frontend-batch-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const settings={cacheRoot:join(root,'cache')},app=join(root,'app');mkdirSync(app);
 const snapshot=id=>({sourceSha256:id.repeat(64),sourceCommit:'c'.repeat(40),assets:new Map(Array.from({length:80},(_,i)=>['assets/'+i+'.js',{bytes:Buffer.from('asset-'+i)}]))});
 const old=installFrontendSnapshot({root:app,snapshot:snapshot('a'),settings}),markerBytes=readFileSync(join(old,'frontend-manifest.json')).length,current=installFrontendSnapshot({root:app,snapshot:snapshot('b'),settings}),options={root:app,roots:[app],settings,processes:[],apply:true};
 let count=0;assert.throws(()=>retireFrontendSnapshots({...options,afterFile(){if(++count===70)throw Error('interrupt batch');}}),/interrupt batch/);
 const journal=join(settings.cacheRoot,'frontend-retirement.pending.json'),original=readFileSync(journal,'utf8'),bad=JSON.parse(original);bad.batch.files[0].path='../outside';writeFileSync(journal,JSON.stringify(bad));assert.throws(()=>retireFrontendSnapshots(options),/batch changed/);writeFileSync(journal,original);
 const result=retireFrontendSnapshots(options);assert.equal(existsSync(old),false);assert.equal(result.deletedBytes,snapshot('a').assets.values().reduce((n,e)=>n+e.bytes.length,0)+markerBytes);
 for(let i=0;i<80;i++)assert.equal(readFileSync(join(current,'assets/'+i+'.js'),'utf8'),'asset-'+i);
});
