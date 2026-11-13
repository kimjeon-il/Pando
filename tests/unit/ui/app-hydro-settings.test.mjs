import * as __authored_hydro_0 from "node:test";
import * as __authored_hydro_1 from "node:assert/strict";
import * as __authored_hydro_2 from "../../../src/document/project-session.js";
import * as __authored_hydro_3 from "../../../src/ui/physical-settings.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHydroSettings } from "../../../src/ui/physical-settings.js";

test('built-in hydro lookup uses tiled features by cache key and logical ID', () => {
  const feature = { id: 'fragment', properties: { pandolab_id: 'river-1' } };
  const settings = createHydroSettings();
  settings.connect({ projectState: { state: { hydroFeatureCache: new Map([['fragment', feature]]) } } });
  const detached = settings.allBuiltInHydroFeatures();
  assert.deepEqual(detached, [feature]);
  detached.length = 0;
  assert.deepEqual(settings.allBuiltInHydroFeatures(), [feature], 'enumeration cannot mutate the cached source');
  assert.equal(settings.builtInHydroFeatureById('fragment'), feature);
  assert.equal(settings.builtInHydroFeatureById('river-1'), feature);
  assert.equal(settings.builtInHydroFeatureById('missing'), null);
});

test('physical hydro keeps original source bytes but never exposes a project-replaced source as another object',()=>{
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

// authored hydro contracts share this owner suite.
{
const test = __authored_hydro_0.default;
const assert = __authored_hydro_1.default;
const createProjectSession = __authored_hydro_2["createProjectSession"];
const createHydroSettings = __authored_hydro_3["createHydroSettings"];
function acceptedRows() {
  let accessCount=0;
  const row=(id,source)=>Object.freeze({
    id,properties:Object.freeze({
      get sourceFeatureId(){accessCount++;return source;},
      category:'river',
    }),
  });
  return {row,get accessCount(){return accessCount;}};
}

function createAcceptedViewerSession(readRows) {
  const session=createProjectSession({productMode:'viewer',readOnly:true});
  session.connect({
    applicationConstantsA:{DISTRIBUTION_RENDER_MODES:{OVERLAP:'overlap'}},
    modelValidation:{normalizeLayerPresentation:value=>value},
    uiFactoriesA:{createAtomicMapStateController:()=>({})},
    physicalConfig:{PHYSICAL_DATASET:'synthetic-terrain'},
  });
  session.initializeMapWorkScheduler();
  const documentModel={
    snapshot:()=>({documentId:'project-A',distributionSettings:{renderMode:'overlap',activeLayerId:''},
      layerPresentation:{schemaVersion:5,styles:{}}}),
    geometry:()=>null,
    list:()=>readRows(),
  };
  session.installDocumentProjection({
    documentModel,commandOwner:{state:()=>({epoch:1,dirtyTerritorialIds:[]})},
    entityStore:{snapshot:()=>[]},
  });
  return session;
}

test('repeated visibility reads reuse the same accepted hydro source index',()=>{
  const probe=acceptedRows();
  let rows=Object.freeze([probe.row('authored:A','source:A')]);
  const session=createAcceptedViewerSession(()=>rows);
  session.setViewingPresentation({itemVisibility:{objects:{},hydro:{'source:A':true,'manually:hidden':false}}});
  const first=session.state.itemVisibility;
  assert.equal(first.hydro['source:A'],false,'authored source overrides temporary viewing preferences');
  assert.equal(first.hydro['manually:hidden'],false);
  assert.equal(probe.accessCount,1);
  assert.equal(session.state.itemVisibility.hydro['source:A'],false);
  assert.equal(probe.accessCount,1,'cached source mask prevents a repeated full authored scan');
  rows=Object.freeze([probe.row('authored:B','source:B')]);
  const changed=session.state.itemVisibility;
  assert.equal(changed.hydro['source:B'],false,'new accepted Core list invalidates the mask');
  assert.equal(changed.hydro['source:A'],true,'old source is no longer project-replaced');
  assert.equal(probe.accessCount,2);
  assert.equal(session.state.hydroEdits,rows);
  assert.equal(session.state.itemVisibility.hydro['source:B'],false);
  assert.equal(probe.accessCount,2);
});

test('hydro edit and visible-source lookups use the same immutable authored index',()=>{
  const probe=acceptedRows();
  const authored=probe.row('authored:A','source:A'),rows=Object.freeze([authored]);
  const state={hydroEdits:rows,hydroFeatureCache:new Map()};
  const physical=createHydroSettings();
  physical.connect({projectState:{state}});
  assert.strictEqual(physical.hydroEditById(authored.id),authored);
  assert.strictEqual(physical.hydroFeatureById(authored.id),authored);
  assert.equal(physical.hydroEditById('absent'),null);
  assert.equal(physical.isHydroEditFeature(authored),true);
  assert.equal(physical.isHydroEditFeature({...authored,properties:{}}),false);
  assert.equal(probe.accessCount,1,'all operations share the accepted index');
  state.hydroEdits=Object.freeze([probe.row('authored:B','source:B')]);
  assert.equal(physical.hydroEditById(authored.id),null);
  assert.equal(physical.hydroEditById('authored:B')?.id,'authored:B');
  assert.equal(probe.accessCount,2,'a different authored list triggers a rebuild');
});
}
