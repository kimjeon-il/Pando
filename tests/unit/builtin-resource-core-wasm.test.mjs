import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createNodeCoreProject} from '../helpers/core-project.mjs';
import {createPlaceRuntime} from "../../shared/frontend/js/modules/place-runtime.js";
import {normalizePlace} from "../../shared/frontend/js/modules/place-contract.js";
import {createPhysicalResources} from "../../shared/frontend/js/modules/physical-resources.js";

test('actual C++ catalogs keep independent live place and hydro identities across source admission',async t=>{
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  let places,physical;
  const owner=await createNodeCoreProject(seed,{readBuiltinSelectionCatalogs:()=>[
    {domain:'placeBuiltin',refs:places.selectionReferences()},
    {domain:'hydroBuiltin',refs:physical.builtinHydroSelectionReferences()},
  ]});
  t.after(()=>owner.dispose());
  const record=normalizePlace({source:'synthetic',sourceId:'loaded',name:'Loaded',kind:'city',coordinates:[0,0]});
  places=createPlaceRuntime({rpc:{request:async()=>({result:{records:[record],signature:'loaded'}}),stop(){}},
    admitReferences:refs=>owner.project.admitSelectionCatalog('placeBuiltin',refs)});
  t.after(()=>places.dispose());
  const cache=new Map(),descriptor={id:'fragment:7',__fid:7,properties:{pandolab_id:'river:logical',layer_id:'rivers'},geometry:null};
  cache.set('river:logical',descriptor);
  physical=createPhysicalResources();physical.connect({projectState:{state:{hydroFeatureCache:cache}},
    hydroPresentation:{allBuiltInHydroFeatures:()=>[...cache.values()],HYDRO_LAYER_META:{rivers:{category:'river'}},hydroCategoryKey:value=>value},
    domains:{projectDomain:owner.project}});
  await physical.admitHydroFeatures([{id:'feature:logical',properties:{pandolab_id:'river:logical',layer_id:'rivers'},
    geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}}]);
  const hydro={domain:'hydroBuiltin',type:'river',id:'river:logical'};
  await owner.client.selectionApply({action:'replace',ref:hydro});
  assert.equal(await places.prepare({threshold:1}),true);
  const place={domain:'placeBuiltin',type:'city',id:record.id};
  await owner.client.selectionApply({action:'setMany',refs:[place,hydro],primary:hydro});
  await owner.client.selectionApply({action:'setHover',ref:hydro,source:'map'});
  const before=owner.client.state();
  await owner.project.admitSelectionCatalog('placeBuiltin',[]);
  const remaining=await owner.client.selectionSnapshot();
  assert.deepEqual(remaining.items,[hydro]);assert.deepEqual(remaining.primary,hydro);assert.deepEqual(remaining.hover,hydro);
  assert.equal(owner.client.state().checkpoint,before.checkpoint);assert.equal(owner.client.state().canUndo,false);
  await owner.project.admit(seed);
  await owner.client.selectionApply({action:'setMany',refs:[place,hydro],primary:place});
  const readmitted=await owner.client.selectionSnapshot();
  assert.deepEqual(readmitted.items,[place,hydro]);assert.deepEqual(readmitted.primary,place);
  assert.equal(cache.get('river:logical'),descriptor);assert.equal(descriptor.__fid,7);
  assert.deepEqual(owner.documentModel.snapshot(),seed,'resource admission never becomes stored project content');
});
