import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,statSync,rmSync,existsSync} from 'node:fs';
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
 assert.throws(()=>retireFrontendSnapshots({...options,apply:true,afterFile(){throw Error('interrupt');}}),/interrupt/);
 const result=retireFrontendSnapshots({...options,apply:true});assert.ok(result.deletedBytes>0);assert.equal(existsSync(old),false);
 assert.equal(readFileSync(join(current,'index.html'),'utf8'),'shared');assert.equal(statSync(join(current,'index.html')).mode&0o200,0);
});
