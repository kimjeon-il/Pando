import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installFrontendSnapshot} from '../../tools/worktree-storage.mjs';
test('immutable frontend outputs reuse file IDs and resume an interrupted installation',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-frontend-store-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const settings={cacheRoot:join(root,'cache')},app=join(root,'one');mkdirSync(app);
 const snapshot={sourceSha256:'a'.repeat(64),sourceCommit:'b'.repeat(40),dataCommit:'c'.repeat(40),assets:new Map([['index.html',{bytes:Buffer.from('same')}],['assets/a.js',{bytes:Buffer.from('same')}]])};
 assert.throws(()=>installFrontendSnapshot({root:app,snapshot,settings,afterFile(){throw Error('interrupt');}}),/interrupt/);
 const first=installFrontendSnapshot({root:app,snapshot,settings}),second=installFrontendSnapshot({root:app,snapshot,settings});
 assert.equal(first,second);assert.equal(statSync(join(first,'index.html')).ino,statSync(join(first,'assets/a.js')).ino);assert.equal(statSync(join(first,'index.html')).mode&0o200,0);assert.equal(readFileSync(join(first,'index.html'),'utf8'),'same');
});
