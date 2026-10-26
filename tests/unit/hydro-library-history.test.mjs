import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeTerritorialLibraryEntity,selectGeometryVersion,instantiateLibraryEntity} from '../../apps/editor/frontend/js/modules/territorial-library.js';
import {prepareLibraryGeometryWorkspace,collectLibraryGeometryChanges} from '../../apps/editor/frontend/js/modules/library-geometry-context.js';
import {normalizeTimelineRecords,timelineObjectCatalog} from '../../shared/frontend/js/modules/timeline-records.js';

const polygon=n=>({type:'Polygon',coordinates:[[[0,0],[n,0],[n,n],[0,n],[0,0]]]});
const entity=kind=>({schemaVersion:2,entityId:'waterbody:fixture',entityKind:kind,lineageId:'fixture',names:{ko:'Water'},alternateNames:[],
  lifetime:{validFrom:null,validTo:null},parentEntityId:'',instantiation:{mode:'independent',countryUpdates:{}},metadata:{},sourceInfo:{},
  geometryVersions:[{versionId:'old',validFrom:null,validTo:'1922-12-29',certainty:'confirmed',geometry:kind==='river'?{type:'LineString',coordinates:[[0,0],[1,1]]}:polygon(2)},
    {versionId:'new',validFrom:'1922-12-30',validTo:null,certainty:'confirmed',rendering:kind==='river'?{stroke_widths:[[2,3]],connectivity:{node:'b'}}:{},geometry:kind==='river'?{type:'LineString',coordinates:[[0,0],[2,1]]}:polygon(3)}]});

for(const kind of ['river','lake'])test(`${kind} library source uses the shared selector and ordinary geometry workspace`,async()=>{
  const source=normalizeTerritorialLibraryEntity(entity(kind));
  assert.equal(selectGeometryVersion(source,'1922-12-29').versionId,'old');
  assert.equal(selectGeometryVersion(source,'1922-12-30').versionId,'new');
  const index={entities:[{...source,bbox:[0,0,3,3]}]};
  const workspace=await prepareLibraryGeometryWorkspace({index,readEntity:async()=>source,entityId:source.entityId,versionId:'new',appVersion:'fixture'});
  assert.equal(workspace.project.territorialEntities.length,0);
  assert.equal(workspace.project.hydroEdits.length,1);
  assert.deepEqual(instantiateLibraryEntity(source,'1922-12-30').rendering,source.geometryVersions[1].rendering);
  assert.deepEqual(workspace.project.timelineRecords.geometryBindings[0].rendering,source.geometryVersions[1].rendering);
  assert.equal(workspace.project.hydroEdits[0].geometry,null);
  assert.equal(workspace.project.timelineRecords.parentRelations.length,0);
  assert.equal(workspace.project.timelineRecords.geometryBindings[0].objectRef.domain,'hydro');
  assert.doesNotThrow(()=>normalizeTimelineRecords(workspace.project.timelineRecords,{entities:timelineObjectCatalog(workspace.project),geometryExists:()=>true}));
  const edited=structuredClone(workspace.initialFeatures);
  if(kind==='lake')edited[0].geometry=polygon(4);else edited[0].geometry.coordinates[1][0]=3;
  const changed=collectLibraryGeometryChanges(workspace,edited);
  assert.equal(changed.length,1);
  assert.equal(changed[0].entityId,source.entityId);
  assert.deepEqual(changed[0].lifetime,source.lifetime);
  assert.deepEqual(changed[0].geometryVersions[0],source.geometryVersions[0]);
  assert.deepEqual(changed[0].geometryVersions[1].geometry,edited[0].geometry);
});
