import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {verifyPublishedWorldBundle,publishWorldBundle,contentAddress,ROLES} from '../../../tools/build/build-world-bundle.mjs';
import {readProjectGenerationContext,readProjectWorldGenerationContext,validateProjectGenerationInputs}
 from '../../../tools/build/project-generation-context.mjs';
import {collectRuntimeDataAssets} from '../../../src/data/runtime-manifest-assets.js';
import {mapProjectResourcePaths} from '../../../src/data/map-project-manifest.js';

const root=new URL('../../../',import.meta.url).pathname;
test('generation input receipts are private source selectors, not Viewer publication data',()=>{
 const context=readProjectGenerationContext({root});
 assert.equal(context.projectId,'default-world');
 assert.equal(context.catalogs.world,'assets/data/world/current.json');
 assert.equal(context.catalogs.territorial,'assets/data/builtin-world/generated/v1/index.json');
 assert.equal(context.catalogs.preparedMeshes,'assets/data/prepared-polygons/generated/v2/manifest.json');
 assert.equal(context.source('territorialSourceRoot'),'assets/data/territorial-entities/source');
 assert.equal(context.source('worldBuildRecipe'),'assets/data/world/build-input.json');
 assert.equal(Object.hasOwn(context.project.resources,'generationInputs'),false);
 assert.ok(!JSON.stringify(context.project).includes('generation-inputs.json'));
});
test('alternate projects use their own generation inputs and output catalog roles',()=>{
 const source=JSON.parse(readFileSync(new URL('../../../projects/default-world/manifest.json',import.meta.url)));
 const generation=JSON.parse(readFileSync(new URL('../../../projects/default-world/generation-inputs.json',import.meta.url)));
 const selected={...source,projectId:'alternate-world',resources:{...source.resources,
  world:{catalog:'assets/data/alternate-world/current.json'},
  territorial:{catalog:'assets/data/alternate-world/countries/index.json'},
  preparedMeshes:{catalog:'assets/data/alternate-world/meshes/manifest.json'}}};
 const alt={...generation,projectId:'alternate-world',inputs:{...generation.inputs,
   territorialSourceRoot:'assets/data/alternate-world/source',
   territorialSourceIndex:'assets/data/alternate-world/source-index.json'}};
 const fake=new Map([['projects/alternate-world/manifest.json',JSON.stringify(selected)],
  ['projects/alternate-world/generation-inputs.json',JSON.stringify(alt)]]);
 const ctx=readProjectGenerationContext({projectId:'alternate-world',root,readSource:path=>{
  if(!fake.has(path))throw new Error('Unexpected authoring source');
  return fake.get(path);
 }});
 assert.equal(ctx.catalogs.territorial,selected.resources.territorial.catalog);
 assert.equal(ctx.catalogs.preparedMeshes,selected.resources.preparedMeshes.catalog);
 assert.equal(ctx.source('territorialSourceIndex'),alt.inputs.territorialSourceIndex);
 assert.throws(()=>validateProjectGenerationInputs({...alt,inputs:{...alt.inputs,
   worldView:'assets/data/../escape.json'}},'alternate-world'),/Unsafe/);
 assert.throws(()=>validateProjectGenerationInputs(generation,'alternate-world'),/identity|Invalid/);
});

test('project Viewer closure excludes private authoring inputs and retains pinned derivative catalogs',()=>{
 const context=readProjectGenerationContext({root});
 const project=context.project,catalogs=mapProjectResourcePaths(project);
 const hydroPayload='assets/data/hydro/v0.13.4/fixture.bin';
 const landPayload='assets/data/physical-land/fixture.bin';
 const inputPaths=Object.values(context.generation.inputs);
 const specs={
  [context.catalogs.world]:{assets:{}},
  [context.catalogs.territorial]:{schema:'pandolab-builtin-world',schemaVersion:2,storageLayout:'descriptor-geometries-v1',entities:[],geometryAssets:[]},
  [context.catalogs.preparedMeshes]:{meshes:{}},
  [context.catalogs.rivers]:{container:{url:'fixture.bin'},shards:[]},
  [context.catalogs.places]:{shards:{}},
  [project.resources.placeLifetimes.catalog]:{entries:[]},
  [project.resources.terrain.catalog]:{tiles:{}},
  [context.catalogs.physicalLand]:{asset:{url:landPayload}},
 };
 const selected=collectRuntimeDataAssets({availablePaths:[
   ...catalogs,hydroPayload,landPayload,...inputPaths],
  projectManifest:project,
  readManifest:path=>{assert.ok(specs[path],path);return specs[path];}});
 for(const input of inputPaths)assert.equal(selected.has(input),false,
   'Viewer publication cannot ship authoring input: '+input);
 assert.equal(selected.has(context.catalogs.territorial),true);
 assert.equal(selected.has(context.catalogs.preparedMeshes),true);
 assert.equal(selected.has(hydroPayload),true);
 assert.equal(selected.has(landPayload),true);
});

test('world generators select the same project source recipe and reject cross-project output aliases',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../../../projects/default-world/manifest.json',import.meta.url)));
 const generation=JSON.parse(readFileSync(new URL('../../../projects/default-world/generation-inputs.json',import.meta.url)));
 const projectId='alternate-world';
 const altManifest={...manifest,projectId,resources:{...manifest.resources,
   world:{catalog:'assets/data/alternate-world/current.json'}}};
 const altGeneration={...generation,projectId,inputs:{...generation.inputs,
   territorialCurrentWorld:'assets/data/alternate-world/current-world.geojson',
   worldBuildRecipe:'assets/data/alternate-world/build-input.json'}};
 const recipe={schema:'pandolab-world-build-input',schemaVersion:1,
   canonicalSource:'alternate-world/current-world.geojson',
   legacyPreviewManifest:'alternate-world/preview-v0.36.1.json'};
 const inputs=new Map([
  ['projects/alternate-world/manifest.json',JSON.stringify(altManifest)],
  ['projects/alternate-world/generation-inputs.json',JSON.stringify(altGeneration)],
  ['assets/data/alternate-world/build-input.json',JSON.stringify(recipe)],
 ]);
 const opts={projectId,readSource:path=>{
   if(!inputs.has(path))throw Error('Unapproved generation input '+path);
   return inputs.get(path);
 }};
 const selected=readProjectWorldGenerationContext(opts);
 assert.equal(selected.projectId,projectId);
 assert.equal(selected.catalogs.world,altManifest.resources.world.catalog);
 assert.equal(selected.worldRecipe.canonicalSource,'alternate-world/current-world.geojson');
 assert.equal(selected.worldRecipePath,altGeneration.inputs.worldBuildRecipe);
 inputs.set('projects/alternate-world/manifest.json',JSON.stringify({
   ...altManifest,resources:{...altManifest.resources,
     world:manifest.resources.world},
 }));
 assert.throws(()=>readProjectWorldGenerationContext(opts),/project-owned/);
 inputs.set('projects/alternate-world/manifest.json',JSON.stringify(altManifest));
 inputs.set(altGeneration.inputs.worldBuildRecipe,JSON.stringify({...recipe,
   canonicalSource:'territorial-entities/generated/current-world.geojson'}));
 assert.throws(()=>readProjectWorldGenerationContext(opts),/differs/);
 inputs.set(altGeneration.inputs.worldBuildRecipe,JSON.stringify({...recipe,
   legacyPreviewManifest:'world-preview-v0.36.1.json'}));
 assert.throws(()=>readProjectWorldGenerationContext(opts),/project-owned/);
 inputs.set(altGeneration.inputs.worldBuildRecipe,JSON.stringify({...recipe,
   legacyPreviewManifest:'../unsafe-preview-v0.36.1.json'}));
 assert.throws(()=>readProjectWorldGenerationContext(opts),/Unsafe/);
});

test('P2 generation graph fingerprints the selected project input mapping and catalog identity',()=>{
 const graph=JSON.parse(readFileSync(new URL('../../../config/generated-artifacts.json',import.meta.url)));
 const families=new Map(graph.families.map(f=>[f.id,f]));
 for(const id of ['builtin-world','world-mesh','world-preview','world-bundle','prepared-mesh']){
  const inputs=families.get(id)?.inputs;
  assert.ok(inputs?.includes('projects/default-world/generation-inputs.json'),id+' missing authored source mapping');
  assert.ok(inputs?.includes('projects/default-world/manifest.json'),id+' missing Viewer catalog ownership');
 }
 const world=families.get('world-mesh');
 assert.ok(world.dependencies.includes('current-world'), 'country source remains a versioned dependency');
 assert.ok(families.get('world-preview').dependencies.includes('world-mesh'), 'preview cannot bypass its mesh');
});

test('Viewer-only world checks verify pinned bytes without private GIS generation recipes',t=>{
 const root=mkdtempSync(join(tmpdir(),'pando-published-world-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,content)=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,content);};
 const manifest=readFileSync(new URL('../../../projects/default-world/manifest.json',import.meta.url));
 const generation=readFileSync(new URL('../../../projects/default-world/generation-inputs.json',import.meta.url));
 put('projects/default-world/manifest.json',manifest);
 put('projects/default-world/generation-inputs.json',generation);
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 const assets={};
 for(const role of Object.keys(ROLES)){
  const decoded=Buffer.from('immutable-'+role);
  const encoding=role==='labelAnchors'?'identity':'gzip';
  const bytes=encoding==='gzip'?gzipSync(decoded):decoded;
  const sha=digest(bytes),url=contentAddress(role,sha);
  put('assets/data/'+url,bytes);
  assets[role]={url,sha256:sha,compressedBytes:bytes.length,decodedBytes:decoded.length,encoding};
 }
 for(const role of ['preview','canonical'])
  put('assets/data/shared-'+role+'.json.gz','validated archive data');
 const published={
  schema:'pandolab-world-bundle',schemaVersion:1,
  source:{url:'territorial-entities/generated/current-world.geojson',
    sha256:'b'.repeat(64),countryCount:1},
  defaultClassification:{countries:{A:'digest'}},
  compatibility:{sharedBoundaries:{preview:'shared-preview.json.gz',
    canonical:'shared-canonical.json.gz'}},assets,
 };
 put('assets/data/world/current.json',JSON.stringify(published));
 assert.equal(verifyPublishedWorldBundle({root}).validatedAssets,5);
 const result=publishWorldBundle({root,projectId:'default-world',check:true});
 assert.equal(result.sourceFree,true);
 assert.equal(result.bundle.source.sha256,'b'.repeat(64));
 put('assets/data/'+assets.canonicalMesh.url,Buffer.from('broken'));
 assert.throws(()=>publishWorldBundle({root,projectId:'default-world',check:true}),/integrity/);
});
