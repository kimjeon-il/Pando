import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {buildFrontendSnapshot} from '../../scripts/lib/frontend-build.mjs';
import {frontendFixture as fixture} from '../helpers/frontend-build-fixture.mjs';

test('one source build produces distinct products and generated assets without writing source outputs',async t=>{
 const f=fixture(t),snapshot=await buildFrontendSnapshot(f.options);
 assert.ok(snapshot.html.viewer.includes('assets/js/viewer.js'));
 assert.ok(snapshot.html.editor.includes('assets/js/bootstrap.js'));
 assert.ok(snapshot.assets.has('assets/js/build-meta.js'));
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
