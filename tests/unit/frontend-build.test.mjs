import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildFrontendSnapshot} from '../../scripts/lib/frontend-build.mjs';
import {frontendFixture as fixture} from '../helpers/frontend-build-fixture.mjs';

test('one source build produces distinct products and generated assets without writing source outputs',async t=>{
 const f=fixture(t),snapshot=await buildFrontendSnapshot(f.options);
 assert.ok(snapshot.html.viewer.includes('assets/js/viewer.js'));
 assert.ok(snapshot.html.editor.includes('assets/js/bootstrap.js'));
 assert.ok(snapshot.assets.has('assets/js/build-meta.js'));
 assert.equal(snapshot.buildMeta.worldBundle.url,'assets/data/world/current.json');
 assert.match(snapshot.buildMeta.worldBundle.sha256,/^[a-f0-9]{64}$/);
 assert.ok(snapshot.assets.has('assets/css/ui.bundle.css'));
 assert.ok(snapshot.viewerPaths.has('assets/js/viewer.js'));
 assert.equal(snapshot.viewerPaths.has('assets/js/bootstrap.js'),false);
 assert.equal(snapshot.assets.get('assets/js/viewer.js').sourcePath,'apps/viewer/js/viewer.js');
 for(const path of ['index.html','assets/js/build-meta.js','apps/editor/editor.html','assets/worker-runtime'])assert.equal(existsSync(join(f.root,path)),false,path);
});

test('a stylesheet edit changes the frontend input identity without native compilation or data preparation',async t=>{
 const f=fixture(t),before=await buildFrontendSnapshot(f.options);f.put('shared/frontend/css/app.css','.x { color: blue; }');
 const after=await buildFrontendSnapshot(f.options);
 assert.notEqual(before.sourceSha256,after.sourceSha256);
 assert.equal(before.dataRevision,after.dataRevision);
});

test('clean LF and CRLF checkouts share identical immutable frontend bytes while binary files stay exact',async t=>{
 const f=fixture(t);
 f.put('shared/frontend/css/app.css','.x { color: red; }\n');
 f.put('apps/viewer/js/viewer.js','export const viewer=true;\n');
 f.put('shared/frontend/static/vendor/NOTICE','Copyright fixture\nTerms remain unchanged.\n');
 const binary=Buffer.from([137,80,78,71,13,10,26,10,255]);
 f.put('shared/frontend/static/img/proof.png',binary);
 const lf=await buildFrontendSnapshot(f.options);
 const crlf=await buildFrontendSnapshot({...f.options,readSourceBytes:path=>{
  const bytes=readFileSync(join(f.root,path));
  return /\.(?:[cm]?js|json|css|html|svg|txt|md)$|\/(?:LICENSE|NOTICE)$/.test(path)?Buffer.from(bytes.toString('utf8').replace(/\r?\n/g,'\r\n')):bytes;
 }});
 assert.equal(crlf.sourceSha256,lf.sourceSha256);
 assert.deepEqual([...crlf.assets].map(([path,row])=>[path,row.bytes]),[...lf.assets].map(([path,row])=>[path,row.bytes]));
 assert.deepEqual(crlf.assets.get('assets/img/proof.png').bytes,binary);
});
