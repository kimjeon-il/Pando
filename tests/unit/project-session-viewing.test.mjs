import {createAtomicMapStateController} from '../../assets/js/modules/map-state-transition.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {createProjectSession} from '../../assets/js/modules/project-session.js';
import {createInitialDocument} from '../../assets/js/modules/initial-document.js';
import {createNodeCoreProject} from '../helpers/core-project.mjs';
import {createTerritorialEntityStore} from '../../assets/js/modules/territorial-entity-store.js';
import {normalizeLayerPresentation} from '../../assets/js/modules/layer-presentation.js';
import {DISTRIBUTION_RENDER_MODES} from '../../assets/js/modules/distribution-model.js';
test('both products use ProjectSession; viewing overrides have no persistence, command or document mutation',async t=>{
 const core=await createNodeCoreProject(createInitialDocument({appVersion:'0.36.0'}),{productMode:'viewer'});t.after(core.dispose);
 const session=createProjectSession({productMode:'viewer'});
 session.connect({readiness:{DATA_READINESS:{PREVIEW:'preview'}},applicationConstantsA:{DISTRIBUTION_RENDER_MODES},
  uiFactoriesA:{createAtomicMapStateController},modelValidation:{normalizeLayerPresentation},physicalConfig:{PHYSICAL_DATASET:'fixture'},domains:{},
  get uiFactoriesB(){assert.fail('viewer must not register save state');}});
 session.initializeMapWorkScheduler();
 const store=createTerritorialEntityStore({documentModel:core.documentModel,commandOwner:core.client});t.after(store.dispose);
 session.installDocumentProjection({documentModel:core.documentModel,commandOwner:core.client,entityStore:store});
 const before=core.documentModel.snapshot(),beforeState=core.client.state();
 assert.strictEqual(session.state.territorialEntities,core.documentModel.territorialViews());
 assert.strictEqual(session.state.genericFeatures,before.genericFeatures);assert.equal(session.saveState,undefined);
 session.state.layerVisibility.countries=false;
 session.setViewingPresentation({physicalSettings:{...session.state.physicalSettings,terrainVisible:false}});
 const viewing=session.captureViewingPresentation();session.setViewingPresentation({},{reset:true});
 assert.equal(session.state.layerVisibility.countries,true);
 session.setViewingPresentation(viewing,{reset:true});assert.equal(session.state.layerVisibility.countries,false);
 assert.equal(session.state.physicalSettings.terrainVisible,false);
 assert.deepEqual(core.documentModel.snapshot(),before);assert.deepEqual(core.client.state(),beforeState);
 assert.throws(()=>session.setViewingPresentation({territorialEntities:[]}),/Unknown viewing state/);
 assert.throws(()=>{session.state.labels=[];},TypeError);
});
