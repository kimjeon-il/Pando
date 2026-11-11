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
 const policy=snapshot.assets.get('assets/js/workers/resource-update-policy-core.js').bytes.toString('utf8');
 assert.match(policy,/PandoLabResourceUpdatePolicy/);
 assert.match(policy,/resourceUpdate/);
 assert.match(policy,/resourceKey/);
 assert.doesNotMatch(policy,/\b(?:import|export)\s+(?:\{|\*|[A-Za-z])/);

 assert.equal(snapshot.buildMeta.projectCatalogs.world.catalog,'assets/data/world/current.json');
 assert.equal(snapshot.buildMeta.mapProject.projectId,'default-world');
 assert.equal(snapshot.buildMeta.projectCatalogs.territorial.catalog,snapshot.buildMeta.mapProject.resources.territorial.catalog);
 assert.equal(snapshot.buildMeta.mapProject.resources.rivers.catalog,snapshot.buildMeta.mapProject.resources.lakes.catalog);
 assert.equal(snapshot.buildMeta.mapProject.resources.places.catalog,'assets/data/places/manifest.json');
 assert.ok(snapshot.viewerPaths.has(snapshot.buildMeta.mapProjectManifest.url));
 assert.equal(Object.hasOwn(snapshot.buildMeta,'initialLandPreview'),false);
 assert.equal([...snapshot.viewerPaths].some(path=>path.includes('initial-land-preview')),false);
 assert.match(snapshot.buildMeta.projectCatalogs.world.sha256,/^[a-f0-9]{64}$/);
 for(const field of ['worldBundle','builtinWorld','preparedPolygonMeshes','physicalLand','physicalWaterObjects','hydroCatalogVersion'])
   assert.equal(Object.hasOwn(snapshot.buildMeta,field),false,'No duplicated global '+field);
 for(const [role,{catalog}] of Object.entries(snapshot.buildMeta.mapProject.resources))
   assert.equal(snapshot.buildMeta.projectCatalogs[role].catalog,catalog);
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


test('selected Hydro and numerical terrain contracts are validated before publication',async t=>{
 const f=fixture(t);
 const hydro='assets/data/hydro/v0.13.4/manifest.json';
 f.metadata[hydro]={...f.metadata[hydro],version:'alternate-release'};
 const other=await buildFrontendSnapshot(f.options);
 assert.equal(other.buildMeta.projectCatalogs.rivers.version,'alternate-release');
 f.metadata[hydro]={...f.metadata[hydro],schema:'invalid'};
 await assert.rejects(buildFrontendSnapshot(f.options),/Hydro catalog/);
 f.metadata[hydro]={...f.metadata[hydro],schema:'pandolab-water-shards-v5'};
 const terrain=f.terrainPath;
 f.metadata[terrain]={...f.metadata[terrain],sourceDem:{landMaskSha256:'other-land'}};
 await assert.doesNotReject(buildFrontendSnapshot(f.options),'DEM samples do not classify physical land');
 f.metadata[terrain]={...f.metadata[terrain],representation:'raster-rgba-v1'};
 await assert.rejects(buildFrontendSnapshot(f.options),/지형 표현 형식/);
});


test('Viewer closure publishes only bounded optional prepared meshes while preserving the full catalog',async t=>{
  const f=fixture(t),directory='assets/data/prepared-polygons/generated/v2/';
  const small=directory+'small.bin.gz',large=directory+'large.bin.gz';
  f.metadata[directory+'manifest.json'].meshes={
    small:{url:small,compressedBytes:65536,sha256:'a'.repeat(64)},
    large:{url:large,compressedBytes:65537,sha256:'b'.repeat(64)},
  };
  f.metadata[small]=Buffer.alloc(65536);
  f.metadata[large]=Buffer.alloc(65537);
  const snapshot=await buildFrontendSnapshot({...f.options,dataPaths:Object.keys(f.metadata)});
  assert.equal(snapshot.buildMeta.projectCatalogs.preparedMeshes.current,true);
  assert.ok(snapshot.viewerPaths.has(directory+'manifest.json'));
  assert.ok(snapshot.viewerPaths.has(small));
  assert.equal(snapshot.viewerPaths.has(large),false);
});

test('obsolete prepared meshes are cache misses, not a source change or deployment failure',async t=>{
 const f=fixture(t),before=await buildFrontendSnapshot(f.options);
 assert.equal(before.buildMeta.mapProject.projectId,'default-world');
 assert.equal(before.buildMeta.projectCatalogs.preparedMeshes.current,true);
 const mesh='assets/data/prepared-polygons/generated/v2/manifest.json';
 const builtin='assets/data/builtin-world/generated/v1/index.json';
 f.metadata[mesh].inputHashes[builtin]='0'.repeat(64);
 const oldTerritory=await buildFrontendSnapshot(f.options);
 assert.equal(oldTerritory.buildMeta.projectCatalogs.preparedMeshes.current,false);
 assert.ok(oldTerritory.viewerPaths.has(mesh),'pinned cache manifest remains published and hash checked');
 f.metadata[mesh].inputHashes[builtin]=createHash('sha256').update(JSON.stringify(f.metadata[builtin])).digest('hex');
 const land='assets/data/physical-land/v1/manifest.json';
 f.metadata[mesh].inputHashes[land]='0'.repeat(64);
 const oldLand=await buildFrontendSnapshot(f.options);
 assert.equal(oldLand.buildMeta.projectCatalogs.preparedMeshes.current,false);
 f.metadata[mesh].inputHashes[land]=createHash('sha256').update(JSON.stringify(f.metadata[land])).digest('hex');
 assert.equal((await buildFrontendSnapshot(f.options)).buildMeta.projectCatalogs.preparedMeshes.current,true);
});


test('changing default-world geography, terrain and mesh catalogs requires no Viewer source changes',async t=>{
 const f=fixture(t),source=JSON.parse(readFileSync(join(f.root,'projects/default-world/manifest.json'),'utf8'));
 const redirected={
  world:'assets/data/world/alternate.json',
  territorial:'assets/data/builtin-world/alternate/index.json',
  physicalLand:'assets/data/physical-land/alternate/manifest.json',
  terrain:'assets/data/terrain/alternate/manifest.json',
  preparedMeshes:'assets/data/prepared-polygons/alternate/manifest.json',
 };
 const meta=f.metadata;
 for(const [role,path] of Object.entries(redirected))
   meta[path]=structuredClone(meta[source.resources[role].catalog]);
 const mesh=meta[redirected.preparedMeshes];
 mesh.inputHashes={
  [redirected.territorial]:createHash('sha256').update(JSON.stringify(meta[redirected.territorial])).digest('hex'),
  [redirected.physicalLand]:createHash('sha256').update(JSON.stringify(meta[redirected.physicalLand])).digest('hex'),
 };
 f.put('projects/default-world/manifest.json',JSON.stringify({
  ...source,resources:Object.fromEntries(Object.entries(source.resources).map(([role,entry])=>
   [role,{catalog:redirected[role]||entry.catalog}])),
 }));
 const output=await buildFrontendSnapshot({...f.options,dataPaths:Object.keys(meta)});
 for(const [role,path] of Object.entries(redirected)){
  assert.equal(output.buildMeta.projectCatalogs[role].catalog,path);
  assert.ok(output.viewerPaths.has(path));
  assert.equal(output.viewerPaths.has(source.resources[role].catalog),false);
 }
 assert.equal(Object.hasOwn(output.buildMeta,'preparedPolygonMeshes'),false);
 assert.equal(Object.hasOwn(output.buildMeta,'worldBundle'),false);
 assert.equal(Object.hasOwn(output.buildMeta,'physicalWaterObjects'),false);
 assert.equal(output.buildMeta.projectCatalogs.preparedMeshes.current,true,
   'a new source-matched mesh cache remains eligible');
});
