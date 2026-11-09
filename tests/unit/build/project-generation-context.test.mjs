import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readProjectGenerationContext,validateProjectGenerationInputs}
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
  [context.catalogs.territorial]:{entities:[],geometryAssets:[]},
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
