import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
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

test('project catalog receipts carry pinned content SHA, version and loading criticality',async t=>{
 const f=fixture(t),result=await buildFrontendSnapshot(f.options),receipts=result.buildMeta.mapProjectCatalogs;
 const path='assets/data/builtin-world/generated/v1/index.json';
 const expected=createHash('sha256').update(Buffer.from(JSON.stringify(f.metadata[path]))).digest('hex');
 assert.equal(receipts.territorial.catalog,path);
 assert.equal(receipts.territorial.sha256,expected);
 assert.equal(receipts.territorial.schema,'pandolab-builtin-world');
 assert.equal(receipts.territorial.schemaVersion,2);
 assert.equal(receipts.rivers.sha256,receipts.lakes.sha256,'one shared Hydro catalog has one byte identity');
 assert.deepEqual(receipts.physicalLand.dependsOn,['terrain']);
 assert.equal(receipts.preparedMeshes.required,false,'prepared geometry is optional for display');
 assert.equal(result.buildMeta.mapProject.document.identityPolicy,'runtime-instance');
 assert.equal(result.buildMeta.mapProject.timeline.precision,'month');
 // Content revision must incorporate the selected bytes, not merely their paths.
 f.metadata['assets/data/places/manifest.json']={shards:{},revisionMarker:'changed'};
 const changed=await buildFrontendSnapshot(f.options);
 assert.notEqual(changed.dataRevision,result.dataRevision);
 assert.notEqual(changed.buildMeta.mapProjectCatalogs.places.sha256,receipts.places.sha256);
});
test('map build rejects malformed pinned catalogs instead of treating them as absent',async t=>{
 const f=fixture(t);
 f.metadata['assets/data/places/manifest.json']=['invalid catalog'];
 await assert.rejects(buildFrontendSnapshot(f.options),/Invalid pinned map project catalog object/);
});

test('selected Hydro source version and land/terrain pairing are validated before publication',async t=>{
 const f=fixture(t);
 const hydro='assets/data/hydro/v0.13.4/manifest.json';
 f.metadata[hydro]={...f.metadata[hydro],version:'alternate-release'};
 const other=await buildFrontendSnapshot(f.options);
 assert.equal(other.buildMeta.hydroCatalogVersion,'alternate-release');
 f.metadata[hydro]={...f.metadata[hydro],schema:'invalid'};
 await assert.rejects(buildFrontendSnapshot(f.options),/Hydro catalog/);
 f.metadata[hydro]={...f.metadata[hydro],schema:'pandolab-water-shards-v5'};
 const terrain='assets/data/terrain-preview/v0.13.3-p2/manifest.json';
 f.metadata[terrain]={...f.metadata[terrain],sourceDem:{landMaskSha256:'other-land'}};
 await assert.rejects(buildFrontendSnapshot(f.options),/Land derivative must match pinned terrain/);
});

test('classic Canvas Worker dependency policy is self-contained after runtime facade migration',async t=>{
 const f=fixture(t),snapshot=await buildFrontendSnapshot(f.options);
 const bundled=snapshot.assets.get('assets/js/workers/resource-update-policy-core.js')?.bytes.toString('utf8');
 assert.ok(bundled,'a generated classic Worker policy must be present');
 assert.match(bundled,/PandoLabResourceUpdatePolicy/);
 assert.match(bundled,/resourceUpdate/);
 assert.match(bundled,/resourceKey/);
 assert.doesNotMatch(bundled,/import\s*(?:\(|['"{*])/);
 assert.doesNotMatch(bundled,/resource-dependency-policy\.js/);
});
