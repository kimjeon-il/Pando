import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startDevelopmentServer} from '../../scripts/frontend-dev-server.mjs';

test('frontend refresh prepares data only when its pin changes and preserves the last valid response',async t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-dev-boundary-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'config'));const pin=revision=>writeFileSync(join(root,'config/library-data.json'),JSON.stringify({schemaVersion:1,repository:'kimjeon-il/PandoLab-library-data',revision:revision.repeat(40),mounts:['assets/data','reports']}));pin('a');
 let prepared=0,generation=0,reject=false;
 const server=await startDevelopmentServer({repository:root,product:'viewer',port:0,observe:false,prepareLibrary:()=>{prepared++;return{};},buildAssets:async()=>{if(reject)throw Error('Invalid edited source');return{assets:new Map([['index.html',{bytes:Buffer.from('<html>'+ ++generation+'</html>')}]]),evidence:{}};}});
 t.after(()=>server.close());const origin='http://127.0.0.1:'+server.server.address().port;
 assert.equal(prepared,1);await server.refresh();await server.refresh();assert.equal(prepared,1);
 assert.ok((await fetch(origin).then(r=>r.text())).includes('<html>3</html>'));
 reject=true;await server.refresh();assert.equal(prepared,1);
 assert.ok((await fetch(origin).then(r=>r.text())).includes('<html>3</html>'));
 assert.match((await fetch(origin+'/__shell/health').then(r=>r.json())).error,/Invalid edited source/);
 reject=false;pin('b');await server.refresh();assert.equal(prepared,2);
});

test('the actual viewer serves the current frontend and blocks editor and repository sources',async t=>{
 const server=await startDevelopmentServer({product:'viewer',port:0,observe:false});t.after(()=>server.close());
 const origin='http://127.0.0.1:'+server.server.address().port;
 assert.equal((await fetch(origin)).status,200);
 assert.equal((await fetch(origin+'/assets/js/viewer.js')).status,200);
 for(const path of ['/assets/js/app.js','/shell/native-storage.js','/AGENTS.md','/apps/editor/src-tauri/Cargo.toml'])assert.equal((await fetch(origin+path)).status,404,path);
});
