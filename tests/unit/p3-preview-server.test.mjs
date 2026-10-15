import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createP3PreviewServer } from '../../scripts/p3-preview-server.mjs';

test('Codespaces preview serves a real branch snapshot but no source or Git metadata',async t=>{
  const base=mkdtempSync(join(tmpdir(),'pando-p3-server-')),root=join(base,'repo');
  mkdirSync(root,{recursive:true});
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const put=(name,data)=>{
    const target=join(root,name);
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,data);
  };
  put('index.html','<!doctype html><title>Pando CI Preview</title>');
  put('assets/js/test.js','export const ready=true;');
  put('assets/wasm/fixture.wasm',Buffer.from([0,97,115,109,1,0,0,0]));
  put('.git/config','private');put('config/toolchain-versions.json','{"private":true}');
  put('native/app/main.cpp','// private native code');
  const outside=join(base,'secret.txt');writeFileSync(outside,'DO_NOT_SERVE');
  symlinkSync(outside,join(root,'assets/outside.txt'));
  const server=createP3PreviewServer(root);
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const address=server.address(),url='http://127.0.0.1:'+address.port;
  const html=await fetch(url+'/');
  assert.equal(html.status,200);
  assert.match(await html.text(),/Pando CI Preview/);
  assert.match(html.headers.get('content-type'),/text\/html/);
  assert.equal((await fetch(url+'/__p3_health')).status,200);
  const js=await fetch(url+'/assets/js/test.js?v=branch');
  assert.equal(js.status,200);assert.match(await js.text(),/ready=true/);
  assert.match(js.headers.get('content-type'),/text\/javascript/);
  const wasm=await fetch(url+'/assets/wasm/fixture.wasm');
  assert.equal(wasm.status,200);assert.equal(wasm.headers.get('content-type'),'application/wasm');
  assert.deepEqual(Buffer.from(await wasm.arrayBuffer()),Buffer.from([0,97,115,109,1,0,0,0]));
  assert.equal((await fetch(url+'/assets/js/test.js',{method:'HEAD'})).status,200);
  for(const blocked of ['/.git/config','/config/toolchain-versions.json','/native/app/main.cpp','/package.json']){
    const res=await fetch(url+blocked);assert.equal(res.status,404,blocked);
  }
  assert.equal((await fetch(url+'/assets/outside.txt')).status,403);
  assert.equal((await fetch(url+'/assets/../.git/config')).status,404);
  assert.equal((await fetch(url+'/assets/js/test.js',{method:'POST'})).status,405);
});
