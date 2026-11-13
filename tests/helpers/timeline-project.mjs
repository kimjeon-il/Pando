import {TERRITORIAL_SCHEMA_VERSION} from "../../src/document/territorial-units.js";
import { timelineStorageCases } from '../fixtures/timeline-storage-cases.mjs';
import { createTerritorialEntityStore } from "../../src/document/territorial-entity-store.js";
import { createTerritorialEntityRepository } from "../../src/document/territorial-entity-repository.js";
import { createNodeCoreProject } from './core-project.mjs';
import {normalizeTerritorialFeature,normalizeTerritorialIdentity,TERRITORIAL_IDENTITY_FIELDS} from '../../src/document/territorial-units.js';
import { DISTRIBUTION_MODES } from "../../src/document/distribution-model.js";
import { afterEach } from 'node:test';
import { createProjectTemplateCompiler } from "../../tools/gis/project-template-compiler.js";
import {createTestViewingSession} from './viewing-project.mjs';

const fixtures=new WeakMap();
const liveFixtures=new Set();

/** Detached input construction only; never a current model or command owner. */
export function staticTerritorialInput(features) {
  const input={territorialEntities:[],timelineRecords:{schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]},geometries:[]};
  for(const raw of features){
    const feature=normalizeTerritorialFeature(raw);
    if(!feature)throw new TypeError('A current territorial feature is required for the fixture');
    const {id,properties:p}=feature,objectRef={domain:'territorial',id},period={validFrom:null,validTo:null};
    input.territorialEntities.push(normalizeTerritorialIdentity({type:'Feature',id,geometry:null,properties:Object.fromEntries(TERRITORIAL_IDENTITY_FIELDS.filter(key=>Object.hasOwn(p,key)).map(key=>[key,p[key]]))}));
    const geometryRef={id:'territorial-geometry:'+id,version:1};
    input.geometries.push({...geometryRef,geojson:structuredClone(feature.geometry)});
    input.timelineRecords.lifetimes.push({id:'lifetime:'+id,objectRef,...period});
    input.timelineRecords.geometryBindings.push({id:'geometry:'+id,objectRef,...period,geometryRef});
    input.timelineRecords.parentRelations.push({id:'parent:'+id,objectRef,...period,parentId:p.parentId,coverageMode:p.coverageMode});
  }
  return input;
}
afterEach(() => {
  for(const fixture of liveFixtures)fixture.dispose();
  liveFixtures.clear();
});

export function projectForStorage(row = timelineStorageCases()[0]) {
  return {
    documentId:'8bb52340-ea7a-4f25-9d38-9adeb8332183',physicalSourceInfo:{},
    territorialEntities: row.entities.map(({ objectRef:{id}, entityKind }) => ({ type: 'Feature', id,
      geometry: null, properties: { schemaVersion: TERRITORIAL_SCHEMA_VERSION, entityKind, name: id, notes: '',
        style: {}, locked: false, metadata: {}, sourceFolderId: '', sourceEntityId: '', sourceGeometryVersion: '' } })),
    projectFields: { timelineRecords: structuredClone(row.input.records),
      geometries: structuredClone(row.input.geometries), sourceInfo: null, labels: [],
      genericFeatures: [], hydroEdits: [], distributionLayers: [], distributionEntries: [],
      labelSettings: {},distributionSettings:{renderMode:'overlap',activeLayerId:'',boundaryVisible:true},projectSetup:{initialMonth:'2026-10',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'},
      layerPresentation: { schemaVersion: 5, styles: {}, objectStyles: {}, objectOrder: [] },
      }, fullAutosave: true,
  };
}

export async function initializeTestTerritorialState(state,t=null,{project,platformPorts={}}={}) {
  if(fixtures.has(state))throw new Error('The current Core fixture is already initialized.');
  const fields=Object.fromEntries(Object.keys(projectForStorage().projectFields)
    .filter(key => Object.hasOwn(state,key) && !['timelineRecords','geometries'].includes(key)).map(key => [key,state[key]]));
  const viewKeys=['layerVisibility','itemVisibility','distributionSettings'];
  
  let viewing;
  const owner=await createNodeCoreProject(project || staticProjectDocument(fields,state.territorialEntities || []),{
    ...platformPorts,viewingPresentation:payload=>viewing.session.applyViewingPresentation(payload),
    persistence:platformPorts.persistence || {queueView(){},queueProject(){},queuePresentation(){},cancelPending(){}}});
  viewing=createTestViewingSession(owner);
  viewing.session.setViewingPresentation(Object.fromEntries(viewKeys.filter(key=>state[key]).map(key=>[key,key==='itemVisibility'?{...viewing.session.state.itemVisibility,...state[key]}:state[key]])));
  const entityStore=createTerritorialEntityStore({ documentModel:owner.documentModel,commandOwner:owner.client });
  const entityRepository=createTerritorialEntityRepository({ entityStore });
  const fixture={ ...owner,viewing,entityStore,entityRepository,dispose() { liveFixtures.delete(fixture);viewing.dispose();entityStore.dispose();owner.dispose(); } };
  fixtures.set(state,fixture);
  liveFixtures.add(fixture);
  const keys=[...Object.keys(projectForStorage().projectFields).filter(key => !['geometries'].includes(key)),...viewKeys];
  const properties=Object.fromEntries(keys.map(key => [key,{ configurable:true,enumerable:true,
    get:() => viewKeys.includes(key)?viewing.session.state[key]:owner.documentModel.snapshot()[key] }]));
  properties.territorialEntities={ configurable:true,enumerable:true,get:entityStore.snapshot };
  const geometries=Object.freeze({ get:owner.documentModel.geometry,snapshot:() => owner.documentModel.snapshot().geometries });
  properties.geometries={ configurable:true,enumerable:true,get:() => geometries };
  properties.stateRevision={ configurable:true,enumerable:true,get:() => owner.client.state().stateRevision };
  properties.timelineCursor={ configurable:true,enumerable:true,get:() => owner.client.state().timelineCursor };
  Object.defineProperties(state,properties);
  Object.defineProperty(state,'historyDirtyEntityIds',{configurable:true,enumerable:true,
    get:()=>new Set(owner.client.state().dirtyTerritorialIds || [])});
  if(t)t.after(fixture.dispose);
  return state;
}

export function testCoreProject(state) {
  const owner=fixtures.get(state);if(!owner)throw new Error('An accepted current Core fixture is required.');return owner;
}

/** Transport/status adaptation only; command rules remain in the actual Core. */
export async function executeTestCommand(state,envelope) {
  const outcome=await testCoreProject(state).project.executeCommand(envelope);
  if(!outcome.ok)throw Object.assign(new Error(outcome.error.message),outcome.error);
  return outcome;
}

/** Explicit test-only ID-domain transport, without validation or mutation. */
export function executeTerritorialTestCommand(state,commandId,payload) {
  const ids=commandId==='territorial.patch'||commandId==='territorial.replace'
    ? [...payload.features.map(row => row.id),...(payload.removedIds || [])]
    : ['territorial.remove','territorial.lock','territorial.color'].includes(commandId) ? payload.ids
    : commandId==='territorial.create' ? [payload.feature.id] : commandId==='territorial.copy-region'
    ? [payload.sourceId,payload.id] : [payload.id];
  return executeTestCommand(state,{ commandId,targets:ids.map(id => ({ domain:'territorial',id })),payload });
}

export function staticSerializerSnapshot(snapshot) {
  const content = staticTerritorialInput(snapshot.territorialEntities);
  return { documentId:projectForStorage().documentId,physicalSourceInfo:{},baseDatasetFingerprint: '1'.repeat(64), ...snapshot, territorialEntities: content.territorialEntities,
    entityDelta: snapshot.entityDelta ? { ...snapshot.entityDelta,
      changed: snapshot.entityDelta.changed.map(feature => content.territorialEntities.find(entity => entity.id === feature.id)) } : undefined,
    projectFields: { ...projectForStorage().projectFields, ...snapshot.projectFields,
      timelineRecords: content.timelineRecords, geometries: content.geometries } };
}

/** Current complete project document for Core/browser fixtures. */
export function staticProjectDocument(projectFields = {}, territorialEntities = []) {
  const snapshot = staticSerializerSnapshot({ territorialEntities, fullAutosave: true, projectFields });
  return createProjectTemplateCompiler({ appVersion: 'fixture', distributionModes: Object.values(DISTRIBUTION_MODES),
    terrainDataset: 'fixture-terrain', hydroDataset: 'fixture-hydro', readSnapshot: () => snapshot }).buildProject();
}

export function snapshotTestTerritorialState(state) {
  return structuredClone(testCoreProject(state).documentModel.snapshot());
}

export async function restoreTestTerritorialState(state, snapshot) {
  await testCoreProject(state).project.admit(snapshot);
}
