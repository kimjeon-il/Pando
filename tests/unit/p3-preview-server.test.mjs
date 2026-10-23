import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createP3PreviewServer, previewFileIdentity } from '../../scripts/p3-preview-server.mjs';

test('planned app assets serve exact ranges without exposing unlisted files', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pando-app-server-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = new Map([['index.html', { bytes: Buffer.from('application') }], ['assets/data/test.bin', { bytes: Buffer.from('0123456789') }]]);
  writeFileSync(join(root, 'empty.css'), '');
  files.set('assets/empty.css', { file: join(root, 'empty.css') });
  const mutable = join(root, 'pinned.bin'); writeFileSync(mutable, 'validated');
  files.set('assets/pinned.bin', { file: mutable, identity: previewFileIdentity(statSync(mutable, { bigint: true })) });
  const server = createP3PreviewServer(root, { assets: () => files });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const part = await globalThis.fetch(base + '/assets/data/test.bin', { headers: { Range: 'bytes=2-5' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(part.headers.get('content-length'), '4');
  assert.equal(await part.text(), '2345');
  assert.equal((await globalThis.fetch(base + '/assets/data/test.bin', { headers: { Range: 'bytes=10-' } })).status, 416);
  assert.equal((await globalThis.fetch(base + '/config/library-data.json')).status, 404);
  assert.equal(await globalThis.fetch(base + '/assets/empty.css').then(response => response.text()), '');
  assert.equal(await globalThis.fetch(base + '/assets/pinned.bin').then(response => response.text()), 'validated');
  writeFileSync(mutable, 'not validated');
  assert.equal((await globalThis.fetch(base + '/assets/pinned.bin')).status, 503);
});

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
  const outside=join(base,'outside');mkdirSync(outside);writeFileSync(join(outside,'secret.txt'),'DO_NOT_SERVE');
  symlinkSync(outside,join(root,'assets/outside'),process.platform==='win32'?'junction':'dir');
  const server=createP3PreviewServer(root);
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const address=server.address(),url='http://127.0.0.1:'+address.port;
  const html=await globalThis.fetch(url+'/');
  assert.equal(html.status,200);
  assert.match(await html.text(),/Pando CI Preview/);
  assert.match(html.headers.get('content-type'),/text\/html/);
  assert.equal((await globalThis.fetch(url+'/__p3_health')).status,200);
  const js=await globalThis.fetch(url+'/assets/js/test.js?v=branch');
  assert.equal(js.status,200);assert.match(await js.text(),/ready=true/);
  assert.match(js.headers.get('content-type'),/text\/javascript/);
  const wasm=await globalThis.fetch(url+'/assets/wasm/fixture.wasm');
  assert.equal(wasm.status,200);assert.equal(wasm.headers.get('content-type'),'application/wasm');
  assert.deepEqual(Buffer.from(await wasm.arrayBuffer()),Buffer.from([0,97,115,109,1,0,0,0]));
  assert.equal((await globalThis.fetch(url+'/assets/js/test.js',{method:'HEAD'})).status,200);
  for(const blocked of ['/.git/config','/config/toolchain-versions.json','/native/app/main.cpp','/package.json']){
    const res=await globalThis.fetch(url+blocked);assert.equal(res.status,404,blocked);
  }
  assert.equal((await globalThis.fetch(url+'/assets/outside/secret.txt')).status,403);
  assert.equal((await globalThis.fetch(url+'/assets/../.git/config')).status,404);
  assert.equal((await globalThis.fetch(url+'/assets/js/test.js',{method:'POST'})).status,405);
});
