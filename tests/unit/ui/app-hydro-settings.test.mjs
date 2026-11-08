import test from 'node:test';
import assert from 'node:assert/strict';
import { createHydroSettings } from "../../../src/ui/physical-settings.js";

test('built-in hydro lookup uses tiled features by cache key and logical ID', () => {
  const feature = { id: 'fragment', properties: { pandolab_id: 'river-1' } };
  const settings = createHydroSettings();
  settings.connect({ projectState: { state: { hydroFeatureCache: new Map([['fragment', feature]]) } } });
  assert.deepEqual(settings.allBuiltInHydroFeatures(), [feature]);
  assert.equal(settings.builtInHydroFeatureById('fragment'), feature);
  assert.equal(settings.builtInHydroFeatureById('river-1'), feature);
  assert.equal(settings.builtInHydroFeatureById('missing'), null);
});

test('P4 physical hydro keeps original source bytes but never exposes a project-replaced source as another object',()=>{
 const source={id:'fragment:7',properties:{pandolab_id:'river:logical',layer_id:'rivers',category:'river'},
  geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}};
 const copy={id:'copy:river',properties:{pandolab_domain:'hydro',pandolab_id:'copy:river',
  sourceFeatureId:'river:logical',category:'river'}};
 const state={hydroEdits:[copy],hydroFeatureCache:new Map([['fragment:7',source]]),
  layerVisibility:{rivers:true,lakes:true},physicalSettings:{hydroLayers:{}},itemVisibility:{hydro:{}}};
 const settings=createHydroSettings();
 settings.connect({projectState:{state},physicalResources:{isHydroObjectActive:()=>true},
  hydroPresentation:{HYDRO_LAYER_META:{rivers:{category:'river'}},hydroCategoryKey:x=>x},
  layerPresentation:{isLayerItemVisible:()=>true}});
 assert.equal(settings.builtInHydroFeatureById('fragment:7'),source);
 assert.equal(settings.builtInHydroFeatureById('river:logical'),source);
 assert.equal(settings.hydroFeatureById(copy.id),copy);
 assert.equal(settings.hydroFeatureById('fragment:7'),null,'fragment aliases must not resurrect the replaced source');
 assert.equal(settings.hydroFeatureById('river:logical'),null);
 assert.equal(settings.isHydroFeatureVisible(source),false);
 assert.equal(settings.isHydroFeatureVisible(copy),true);
 state.hydroEdits=[];
 assert.equal(settings.hydroFeatureById('fragment:7'),source);
 assert.equal(settings.isHydroFeatureVisible(source),true);
 assert.equal(settings.builtInHydroFeatureById('river:logical'),source);
});
