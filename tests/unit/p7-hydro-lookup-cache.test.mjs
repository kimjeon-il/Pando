import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectSession} from '../../shared/frontend/js/modules/project-session.js';
import {createHydroSettings} from '../../shared/frontend/js/modules/physical-settings.js';

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
    readiness:{DATA_READINESS:{PREVIEW:'preview'}},
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

test('P7 repeated visibility reads reuse the same accepted hydro source index',()=>{
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

test('P7 hydro edit and visible-source lookups use the same immutable authored index',()=>{
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

test('P7 built-in hydro fragment lookup keeps exact IDs and logical aliases without a transient array',()=>{
  const cache=new Map();
  for(let i=0;i<1024;i++){
    const feature={id:'fragment:'+i,properties:{pandolab_id:'logical:'+i,category:'river'}};
    // Use fragment keys to exercise the real fallback, which compares pandolab_id.
    cache.set('fragment:'+i,feature);
  }
  const settings=createHydroSettings();settings.connect({projectState:{state:{hydroEdits:[],hydroFeatureCache:cache}}});
  assert.strictEqual(settings.builtInHydroFeatureById('fragment:512'),cache.get('fragment:512'));
  assert.strictEqual(settings.builtInHydroFeatureById('logical:512'),cache.get('fragment:512'));
  assert.equal(settings.builtInHydroFeatureById('nonexistent'),null);
  assert.equal(settings.allBuiltInHydroFeatures().length,1024,'public enumeration still returns a detached array');
});
