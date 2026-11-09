import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildFrontendSnapshot} from "../../../scripts/lib/frontend-build.mjs";
import {frontendFixture as fixture} from "../../helpers/frontend-build-fixture.mjs";

test('one source build emits only the Viewer runtime shared with Windows reviewer',async t=>{
 const f=fixture(t),snapshot=await buildFrontendSnapshot(f.options);
 assert.ok(snapshot.html.viewer.includes('assets/js/viewer.js'));
 assert.equal(Object.hasOwn(snapshot.html,'editor'),false);
 assert.ok(snapshot.assets.has('assets/js/build-meta.js'));
 assert.equal(snapshot.buildMeta.worldBundle.url,'assets/data/world/current.json');
 assert.equal(snapshot.buildMeta.mapProject.projectId,'default-world');
 assert.equal(snapshot.buildMeta.builtinWorld.url,snapshot.buildMeta.mapProject.resources.territorial.catalog);
 assert.equal(snapshot.buildMeta.mapProject.resources.rivers.catalog,snapshot.buildMeta.mapProject.resources.lakes.catalog);
 assert.equal(snapshot.buildMeta.mapProject.resources.places.catalog,'assets/data/places/manifest.json');
 assert.ok(snapshot.viewerPaths.has(snapshot.buildMeta.mapProjectManifest.url));
 assert.match(snapshot.buildMeta.initialLandPreview.sha256,/^[a-f0-9]{64}$/);
 assert.equal(snapshot.buildMeta.initialLandPreview.sourceSha256,snapshot.buildMeta.physicalLand.sha256);
 assert.ok(snapshot.assets.has(snapshot.buildMeta.initialLandPreview.url));
 assert.ok(snapshot.viewerPaths.has(snapshot.buildMeta.initialLandPreview.url));
 assert.match(snapshot.buildMeta.worldBundle.sha256,/^[a-f0-9]{64}$/);
 assert.ok(snapshot.assets.has('assets/css/ui-viewer.bundle.css'));
 assert.equal(snapshot.assets.has('assets/css/ui.bundle.css'),false);
 assert.ok(snapshot.viewerPaths.has('assets/js/viewer.js'));
 assert.equal(snapshot.viewerPaths.has('assets/js/bootstrap.js'),false);
 assert.equal(snapshot.assets.has('assets/js/bootstrap.js'),false);
 assert.equal(snapshot.assets.get('assets/js/viewer.js').sourcePath,'src/app/viewer.js');
 for(const path of ['index.html','assets/js/build-meta.js','apps/editor/editor.html','assets/worker-runtime'])assert.equal(existsSync(join(f.root,path)),false,path);
});

test('a stylesheet edit changes the frontend input identity without native compilation or data preparation',async t=>{
 const f=fixture(t),before=await buildFrontendSnapshot(f.options);f.put('src/ui/css/app.css','.x { color: blue; }');
 const after=await buildFrontendSnapshot(f.options);
 assert.notEqual(before.sourceSha256,after.sourceSha256);
 assert.equal(before.dataRevision,after.dataRevision);
});

test('clean LF and CRLF checkouts share identical immutable frontend bytes while binary files stay exact',async t=>{
 const f=fixture(t);
 f.put('src/ui/css/app.css','.x { color: red; }\n');
 f.put('src/app/viewer.js','export const viewer=true;\n');
 f.put('assets/vendor/NOTICE','Copyright fixture\nTerms remain unchanged.\n');
 const binary=Buffer.from([137,80,78,71,13,10,26,10,255]);
 f.put('assets/vendor/proof.png',binary);
 const lf=await buildFrontendSnapshot(f.options);
 const crlf=await buildFrontendSnapshot({...f.options,readSourceBytes:path=>{
  const bytes=readFileSync(join(f.root,path));
  return /\.(?:[cm]?js|json|css|html|svg|txt|md)$|\/(?:LICENSE|NOTICE)$/.test(path)?Buffer.from(bytes.toString('utf8').replace(/\r?\n/g,'\r\n')):bytes;
 }});
 assert.equal(crlf.sourceSha256,lf.sourceSha256);
 assert.deepEqual([...crlf.assets].map(([path,row])=>[path,row.bytes]),[...lf.assets].map(([path,row])=>[path,row.bytes]));
 assert.deepEqual(crlf.assets.get('assets/vendor/proof.png').bytes,binary);
});


test('changing project content changes the selected Viewer data closure without changing engine code',async t=>{
 const f=fixture(t);
 const current=JSON.parse(readFileSync(join(f.root,'projects/default-world/manifest.json'),'utf8'));
 const alternate='assets/data/places/alternate.json';
 f.put('projects/default-world/manifest.json',JSON.stringify({...current,resources:{
   ...current.resources,places:{catalog:alternate}}}));
 f.metadata[alternate]={shards:{}};
 const result=await buildFrontendSnapshot({...f.options,dataPaths:Object.keys(f.metadata)});
 assert.equal(result.buildMeta.mapProject.resources.places.catalog,alternate);
 assert.ok(result.viewerPaths.has(alternate));
 assert.equal(result.viewerPaths.has('assets/data/places/manifest.json'),false);
 assert.ok(result.viewerPaths.has(result.buildMeta.mapProjectManifest.url));
});

test('a separately selected project owns the complete published map and place resource closure',async t=>{
 const f=fixture(t);
 const primary=JSON.parse(readFileSync(join(f.root,'projects/default-world/manifest.json'),'utf8'));
 const replacement='assets/data/places/alternate-project.json';
 f.metadata[replacement]={shards:{}};
 f.put('projects/alternate-world/manifest.json',JSON.stringify({...primary,projectId:'alternate-world',resources:{
   ...primary.resources,places:{catalog:replacement}}}));
 const alternate=await buildFrontendSnapshot({...f.options,projectId:'alternate-world',dataPaths:Object.keys(f.metadata)});
 const standard=await buildFrontendSnapshot({...f.options,dataPaths:Object.keys(f.metadata)});
 assert.equal(alternate.buildMeta.mapProject.projectId,'alternate-world');
 assert.equal(alternate.buildMeta.mapProjectManifest.url,'assets/data/projects/alternate-world/manifest.json');
 assert.equal(alternate.viewerPaths.has('assets/data/projects/default-world/manifest.json'),false);
 assert.equal(alternate.viewerPaths.has('assets/data/places/manifest.json'),false);
 assert.ok(alternate.viewerPaths.has(replacement));
 assert.notEqual(alternate.dataRevision,standard.dataRevision);
 await assert.rejects(buildFrontendSnapshot({...f.options,projectId:'../outside'}),/project ID/);
 f.put('projects/wrong-name/manifest.json',JSON.stringify(primary));
 await assert.rejects(buildFrontendSnapshot({...f.options,projectId:'wrong-name'}),/source identity mismatch/);
});
