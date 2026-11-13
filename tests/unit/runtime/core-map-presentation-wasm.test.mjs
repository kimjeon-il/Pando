import { resourceCapabilities } from "../../../src/runtime/resource-capabilities.js";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createMapSettings } from "../../../src/ui/app-map-settings.js";
import { layerStyle } from "../../../src/ui/layer-presentation.js";
import { createNodeCoreProject } from "../../helpers/core-project.mjs";
import { createTestViewingSession } from "../../helpers/viewing-project.mjs";

test('production object controls share one Core policy and preserve object overrides',async t => {
  const seed=JSON.parse(readFileSync(new URL("../../fixtures/portability/web-document-seed.json",import.meta.url),'utf8'));
  seed.layerPresentation.objectStyles['territorial:entity:B']={ colorVisible: true,boundaryVisible: true };
  const owner=await createNodeCoreProject(seed);t.after(() => owner.dispose());
  const viewing=createTestViewingSession(owner);t.after(viewing.dispose);
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{ configurable: true,value: { querySelectorAll: () => [],querySelector: () => null } });
  t.after(() => { if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document; });
  const settings=createMapSettings({capabilities:resourceCapabilities('viewer'),viewPresentation:{applyPresentation:viewing.session.applyViewingPresentation}}),state={ get layerVisibility() { return viewing.session.state.layerVisibility; },
    get layerPresentation() { return viewing.session.state.layerPresentation; } };
  settings.connect({ layerResources:{loadHydroData:async()=>{},preparePlaces:async()=>{}},projectState: { state },platform: { $: () => null },feedback: { reportOperationError: error => assert.fail(error.stack) },
    objectModelA: { expandedMapDisplayGroups: new Set() },preferences: { userPreferences: { labels: { place: { languages: { ko: true } } } } },
    objectDisplay: { invalidateObjectPresentation() {} },rendering: { gpuMapRenderer: { invalidateCountryPalette() {} } },
    territorialModel: { DISTRIBUTION_MODES: { TERRITORIAL: 'territorial',GEOMETRY: 'geometry' } },
    applicationServicesB: { layerStyle },applicationConstantsA: {},platformConfigurationA: {},platformConfigurationB: {},projectServices: { createProjectSerializer: () => ({}) },
    domains: { projectDomain: { ...owner.project,queueViewAutosave() {} },renderingDomain: { invalidateLabels() {},invalidateBaseScene() {},invalidateOverlayStyle() {} } } });
  // The settings adapter is connected and needs no retired initialize method.
  const before=owner.documentModel.snapshot();
  await settings.setLayerVisibility('objectNames',false);
  await settings.setLayerVisibility('objectFlags',false);
  await settings.setLayerVisibility('objects',false);
  assert.equal(state.layerVisibility.objects,false);assert.equal(state.layerVisibility.objectNames,false);assert.equal(state.layerVisibility.objectFlags,false);
  await settings.updateLayerPresentationStyle('objects',{colorVisible:false,boundaryVisible:false});
  assert.equal(viewing.session.state.layerPresentation.styles.objects.colorVisible,false);
  assert.equal(viewing.session.state.layerPresentation.styles.objects.boundaryVisible,false);
  assert.deepEqual(owner.documentModel.snapshot(),before);
  const result=await owner.project.executeCommand({commandId:'presentation.apply',targets:[],payload:{action:'groupStyle',group:'objects',patch:{colorVisible:false,boundaryVisible:false}}});
  assert.equal(result.ok,true);
  const actual=owner.documentModel.snapshot();
  assert.equal(actual.layerPresentation.styles.objects.colorVisible,false);assert.equal(actual.layerPresentation.styles.objects.boundaryVisible,false);
  assert.equal(actual.layerPresentation.objectStyles['territorial:entity:B'].colorVisible,true,'group color visibility must not overwrite the object color override');
  assert.equal(actual.layerPresentation.objectStyles['territorial:entity:B'].boundaryVisible,true,'group boundary visibility must not overwrite the object boundary override');
  assert.equal(layerStyle(actual.layerPresentation,'objects','territorial:entity:B').colorVisible,true);
  assert.equal(layerStyle(actual.layerPresentation,'objects','territorial:entity:B').boundaryVisible,true);
  for(const key of ['countries','subunits','regions'])assert.equal(Object.hasOwn(actual.layerPresentation.styles,key),false);
  assert.deepEqual(actual.geometries,before.geometries);assert.deepEqual(actual.territorialEntities,before.territorialEntities);assert.deepEqual(actual.timelineRecords,before.timelineRecords);assert.deepEqual(actual.sourceInfo,before.sourceInfo);
  assert.equal(owner.client.state().documentDirty,false);assert.equal(owner.client.state().canUndo,false);
});
