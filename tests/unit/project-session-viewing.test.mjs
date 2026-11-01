import {createAtomicMapStateController} from "../../shared/frontend/js/modules/map-state-transition.js";
import test from 'node:test';import assert from 'node:assert/strict';
import {createProjectSession} from "../../shared/frontend/js/modules/project-session.js";
import {createInitialDocument} from "../../shared/frontend/js/modules/initial-document.js";
import {createNodeCoreProject} from '../helpers/core-project.mjs';
import {createTerritorialEntityStore} from "../../shared/frontend/js/modules/territorial-entity-store.js";
import {normalizeLayerPresentation} from "../../shared/frontend/js/modules/layer-presentation.js";
import {DISTRIBUTION_RENDER_MODES} from "../../shared/frontend/js/modules/distribution-model.js";
import {createObjectQuery} from "../../shared/frontend/js/modules/object-query.js";
import {normalizeObjectRef} from "../../shared/frontend/js/modules/object-selection-controller.js";
import {createCameraNavigation} from "../../shared/frontend/js/modules/camera-navigation.js";
import {createHistoryAssembly} from "../../apps/editor/frontend/js/modules/app-history-assembly.js";
import {createApplicationPorts} from "../../apps/editor/frontend/js/modules/app-capability-ports.js";

test('camera snapshots and restored views use navigation without workspace surface forwarding', () => {
 const navigation=createCameraNavigation();
 navigation.connect({platform:{clamp:(value,min,max)=>Math.max(min,Math.min(max,value))}});
 const ports=createApplicationPorts({cameraNavigation:navigation});
 assert.equal(Object.hasOwn(ports.workspaceUiA,'clampViewZooms'),false);
 const session=createProjectSession({productMode:'viewer'});
 session.connect({readiness:{DATA_READINESS:{PREVIEW:'preview'}},applicationConstantsA:{DISTRIBUTION_RENDER_MODES},
  modelValidation:{normalizeLayerPresentation},physicalConfig:{PHYSICAL_DATASET:'fixture'},domains:{},
  uiFactoriesA:{createAtomicMapStateController},mapNavigation:ports.mapNavigation});
 session.initializeMapWorkScheduler();
 const camera=session.atomicMapStateController;
 assert.equal(camera.commit(camera.begin(),{projection:'globe',view:{flatZoom:1000,globeZoom:.01}}),true);
 assert.equal(session.state.projection,'globe');
 assert.equal(session.state.view.flatZoom,64);assert.equal(session.state.view.globeZoom,.72);
 const history=createHistoryAssembly();let restored=0;
 history.connect({domains:{projectDomain:{snapshot:()=>({documentId:'current'})}},projectState:{state:session.state},
  projectSession:{restoreViewingPresentation:()=>restored++,atomicMapStateController:session.atomicMapStateController}});
 assert.equal(history.applyAutosavedView({documentId:'current',view:{flatZoom:.01,globeZoom:1000}}),true);
 assert.equal(session.state.view.flatZoom,.75);assert.equal(session.state.view.globeZoom,32);assert.equal(restored,1);
 assert.equal(history.applyAutosavedView({documentId:'another',view:{flatZoom:2}}),false);
 assert.equal(session.state.view.flatZoom,.75);
});
test('both products use ProjectSession; viewing overrides have no persistence, command or document mutation',async t=>{
 const core=await createNodeCoreProject(createInitialDocument({appVersion:'0.36.0'}),{productMode:'viewer'});t.after(core.dispose);
 const session=createProjectSession({productMode:'viewer',resolveVisibilityGroup:createObjectQuery({selectionServices:{normalizeObjectRef}}).layerGroupForObjectRef});
 session.connect({readiness:{DATA_READINESS:{PREVIEW:'preview'}},applicationConstantsA:{DISTRIBUTION_RENDER_MODES},
  uiFactoriesA:{createAtomicMapStateController},modelValidation:{normalizeLayerPresentation},physicalConfig:{PHYSICAL_DATASET:'fixture'},domains:{},
  get uiFactoriesB(){return assert.fail('viewer must not register save state');}});
 session.initializeMapWorkScheduler();
 const store=createTerritorialEntityStore({documentModel:core.documentModel,commandOwner:core.client});t.after(store.dispose);
 session.installDocumentProjection({documentModel:core.documentModel,commandOwner:core.client,entityStore:store});
 const before=core.documentModel.snapshot(),beforeState=core.client.state();
 assert.strictEqual(session.state.territorialEntities,core.documentModel.territorialViews());
 assert.strictEqual(session.state.genericFeatures,before.genericFeatures);assert.equal(session.saveState,undefined);
 session.applyViewingPresentation({action:'visibility',key:'objects',visible:false});
 session.applyViewingPresentation({action:'groupStyle',group:'objects',patch:{opacity:.25}});
 assert.equal(session.state.layerPresentation.styles.objects.opacity,.25);
 session.applyViewingPresentation({action:'distributionRenderMode',value:'single'});
 assert.equal(session.state.distributionSettings.renderMode,'single');
 session.setViewingPresentation({physicalSettings:{...session.state.physicalSettings,terrainVisible:false}});
 const viewing=session.captureViewingPresentation();session.setViewingPresentation({},{reset:true});
 assert.equal(session.state.layerVisibility.objects,true);
 assert.equal(session.restoreViewingPresentation({documentId:before.documentId,viewingPresentation:viewing}),true);
 assert.equal(session.state.layerVisibility.objects,false);
 assert.equal(session.state.layerPresentation.styles.objects.opacity,.25);
 assert.equal(session.state.physicalSettings.terrainVisible,false);
 assert.deepEqual(core.documentModel.snapshot(),before);assert.deepEqual(core.client.state(),beforeState);
 assert.throws(()=>session.setViewingPresentation({territorialEntities:[]}),/Unknown viewing state/);
 assert.throws(()=>{session.state.labels=[];},TypeError);
});


test('shared workspace restore is document scoped and does not change authored distribution settings',async t=>{
 const seed=createInitialDocument({appVersion:'test'});
 const core=await createNodeCoreProject(seed,{productMode:'viewer'});t.after(core.dispose);
 const session=createProjectSession({productMode:'viewer',resolveVisibilityGroup:createObjectQuery({selectionServices:{normalizeObjectRef}}).layerGroupForObjectRef});
 session.connect({readiness:{DATA_READINESS:{PREVIEW:'preview'}},applicationConstantsA:{DISTRIBUTION_RENDER_MODES},
  uiFactoriesA:{createAtomicMapStateController},modelValidation:{normalizeLayerPresentation},physicalConfig:{PHYSICAL_DATASET:'fixture'},domains:{}});
 session.initializeMapWorkScheduler();const store=createTerritorialEntityStore({documentModel:core.documentModel,commandOwner:core.client});t.after(store.dispose);
 session.installDocumentProjection({documentModel:core.documentModel,commandOwner:core.client,entityStore:store});
 const before=core.documentModel.snapshot();
 assert.equal(session.restoreViewingPresentation({documentId:'another',viewingPresentation:{layerVisibility:{objects:false}}}),false);
 assert.equal(session.state.layerVisibility.objects,true);
 assert.equal(session.restoreViewingPresentation({documentId:seed.documentId,viewingPresentation:{layerVisibility:{objects:false,retiredGroup:false},itemVisibility:{objects:{orphan:false}},distributionSettings:{renderMode:'single',activeLayerId:'missing',boundaryVisible:false}}}),true);
 assert.equal(session.state.layerVisibility.objects,false);assert.equal('retiredGroup' in session.state.layerVisibility,false);
 assert.equal(session.state.distributionSettings.activeLayerId,'');assert.equal(session.state.distributionSettings.renderMode,'single');
 const hydroVisibility={action:'objectVisibility',refs:[{domain:'hydroBuiltin',type:'river',id:'river-123'}]};
 assert.equal(session.applyViewingPresentation({...hydroVisibility,visible:false}).changed,true);
 assert.equal(session.applyViewingPresentation({...hydroVisibility,visible:false}).changed,false,
   'the same hide must not mutate viewing state');
 assert.equal(session.applyViewingPresentation({...hydroVisibility,visible:true}).changed,true);
 assert.equal(session.applyViewingPresentation({...hydroVisibility,visible:true}).changed,false,
   'the same show must not mutate viewing state');
 assert.equal(session.applyViewingPresentation({...hydroVisibility,visible:false}).changed,true);
 session.applyViewingPresentation({action:'objectVisibility',refs:[{domain:'placeBuiltin',type:'city',id:'place-123'}],visible:false});
 session.pruneViewingItems({countryLabelIds:[]});assert.deepEqual(session.state.itemVisibility.objects,{});
 assert.equal(session.state.itemVisibility.hydro['river-123'],false);assert.equal(session.state.itemVisibility.labels['place-123'],false);
 assert.deepEqual(core.documentModel.snapshot(),before);assert.equal(core.client.state().dirty,false);
});
