import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHistoryAssembly} from '../../assets/js/modules/app-history-assembly.js';
import {resolveStartupSource} from '../../assets/js/modules/app-progressive-startup.js';
import {saveBoundDocument} from '../../assets/js/modules/app-file-bindings.js';
import {assertCurrentProjectSchema} from '../../assets/js/modules/project-state.js';
import {restoreTimelineStorage} from '../../assets/js/modules/timeline-storage.js';
import {prepareLibraryGeometryWorkspace, collectLibraryGeometryChanges,
  parseNativeLibraryGeometryRequest, createLibraryGeometryContext} from '../../assets/js/modules/library-geometry-context.js';
import {createRepositoryTerritorialLoader} from '../../assets/js/modules/territorial-entity-loader.js';
import {createTerritorialLibraryService} from '../../assets/js/modules/territorial-library-service.js';
import {markEditedLibrarySource} from '../../assets/js/modules/territorial-library-provenance.js';
import {sharedCalculationCore} from '../../assets/js/modules/temporal.js';
import {confirmLibraryGeometryBeforeUnload} from '../../assets/js/modules/app-global-input-bindings.js';

const polygon=(left,right)=>({type:'Polygon',coordinates:[[[left,0],[right,0],[right,1],[left,1],[left,0]]]});
const version=(versionId,geometry,validFrom='1900-01-01',validTo='1900-12-31')=>
  ({versionId,validFrom,validTo,certainty:'confirmed',sourceId:'map',geometry});
const entity=(id,geometry,from='1900-01-01',to='1900-12-31')=>({
  schemaVersion:2,entityId:id,entityKind:'general',lineageId:id,names:{ko:id},alternateNames:[],
  lifetime:{validFrom:from,validTo:to},parentEntityId:'',geometryVersions:[version(`${id}-v1`,geometry,from,to)],
  instantiation:{mode:'independent',countryUpdates:{}},metadata:{},sourceInfo:{title:'map'},
});
const originals=[entity('state:A',polygon(0,1)),entity('state:B',polygon(1,2)),entity('state:C',polygon(4,5))];
const index={entities:originals.map(row=>({...row,bbox:row.geometryVersions[0].geometry.coordinates[0]
  .reduce((box,[x,y])=>[Math.min(box[0],x),Math.min(box[1],y),Math.max(box[2],x),Math.max(box[3],y)],
    [Infinity,Infinity,-Infinity,-Infinity]),geometryVersions:row.geometryVersions.map(({geometry,...rest})=>rest)}))};

test('a native query activates geometry editing only with the native bridge',()=>{
  const search='?libraryEntity=state%3AA&libraryVersion=state%3AA-v1';
  assert.equal(parseNativeLibraryGeometryRequest(search,false),null);
  assert.deepEqual(parseNativeLibraryGeometryRequest(search,true),{entityId:'state:A',versionId:'state:A-v1'});
});

test('selected source and touching neighbor become one static scratch document',async()=>{
  const workspace=await prepareLibraryGeometryWorkspace({index,readEntity:async id=>originals.find(row=>row.entityId===id),
    entityId:'state:A',versionId:'state:A-v1',appVersion:'test',today:()=> '2026-10-21'});
  assert.deepEqual(workspace.project.territorialEntities.map(row=>row.id),['state:A','state:B']);
  assert.ok(workspace.project.territorialEntities.every(row=>row.geometry===null));
  assert.ok(workspace.project.timelineRecords.geometryBindings.every(row=>row.validFrom===null&&row.validTo===null));
  assert.equal(workspace.project.geometries.length,2);
  assert.equal(workspace.project.territorialEntities[0].properties.sourceGeometryVersion,'state:A-v1');
  assert.equal(workspace.referenceDate,'1900-01-01');
  assert.doesNotThrow(()=>assertCurrentProjectSchema(workspace.project));
  assert.doesNotThrow(()=>restoreTimelineStorage({schemaVersion:1,records:workspace.project.timelineRecords,
    geometries:workspace.project.geometries},workspace.project.territorialEntities.map(row=>({id:row.id,entityKind:row.properties.entityKind}))));
  const session=new sharedCalculationCore.DocumentSession({validateFlagDataUrl:()=>true});
  const state=session.documentLoad(JSON.stringify(workspace.project),workspace.project.projectSetup.initialMonth);
  assert.equal(state.timelineEditsEnabled,false);
  assert.deepEqual(session.resolveWorld(state.timelineCursor,state.epoch).entities.map(row=>row.id),
    ['state:A','state:B']);
});

test('save projection changes only matching source versions and preserves exact dates',async()=>{
  const workspace=await prepareLibraryGeometryWorkspace({index,readEntity:async id=>originals.find(row=>row.entityId===id),
    entityId:'state:A',versionId:'state:A-v1',appVersion:'test',today:()=> '2026-10-21'});
  const edited=workspace.initialFeatures.map(row=>row.id==='state:A'?{...row,geometry:polygon(0,1.1)}:row);
  const changes=collectLibraryGeometryChanges(workspace,edited);
  assert.deepEqual(changes.map(row=>row.entityId),['state:A']);
  assert.equal(changes[0].geometryVersions[0].validFrom,'1900-01-01');
  assert.equal(changes[0].geometryVersions[0].validTo,'1900-12-31');
  assert.deepEqual(changes[0].geometryVersions[0].geometry,polygon(0,1.1));
});

test('manual geometry edits invalidate inherited verification and retain original geometry hashes as source evidence',async()=>{
  const historic=entity('state:Verified',polygon(0,1));
  historic.geometryVersions[0].historicalProvenance={evidenceStatus:'verified',
    verifiedHistoricalGeometry:true,independentPeriodScreenDeltaChecked:true,archive:'period-map'};
  historic.sourceInfo.geometrySha256='old-source-hash';
  historic.metadata.geometrySha256='old-metadata-hash';
  const workspace=await prepareLibraryGeometryWorkspace({index:{entities:[{entityId:historic.entityId,bbox:[0,0,1,1]}]},
    readEntity:async()=>historic,entityId:historic.entityId,versionId:'state:Verified-v1',appVersion:'test'});
  const edited=workspace.initialFeatures.map(row=>({...row,geometry:polygon(0,1.1)}));
  const [patch]=collectLibraryGeometryChanges(workspace,edited);
  const changed=markEditedLibrarySource(patch,historic,'user-map-editor');
  const provenance=changed.geometryVersions[0].historicalProvenance;
  assert.equal(provenance.evidenceStatus,'provisional');
  assert.equal(provenance.verifiedHistoricalGeometry,false);
  assert.equal(provenance.independentPeriodScreenDeltaChecked,false);
  assert.equal(provenance.editMethod,'user-map-editor');
  assert.equal(provenance.archive,'period-map');
  assert.equal(changed.sourceInfo.geometrySha256,undefined);
  assert.equal(changed.sourceInfo.originalSourceGeometrySha256,'old-source-hash');
  assert.equal(changed.metadata.geometrySha256,undefined);
  assert.equal(changed.metadata.originalSourceGeometrySha256,'old-metadata-hash');
});

test('shared border save rejects a neighbor with a different source interval',async()=>{
  const mismatch=[originals[0],entity('state:B',polygon(1,2),'1800-01-01','2000-12-31'),originals[2]];
  const workspace=await prepareLibraryGeometryWorkspace({index,readEntity:async id=>mismatch.find(row=>row.entityId===id),
    entityId:'state:A',versionId:'state:A-v1',appVersion:'test',today:()=> '2026-10-21'});
  const edited=workspace.initialFeatures.map(row=>row.id==='state:B'?{...row,geometry:polygon(1,2.1)}:row);
  assert.throws(()=>collectLibraryGeometryChanges(workspace,edited),/validity|기간/);
});

test('a shared-border edit keeps matching neighbor versions together in one patch',async()=>{
  const workspace=await prepareLibraryGeometryWorkspace({index,readEntity:async id=>originals.find(row=>row.entityId===id),
    entityId:'state:A',versionId:'state:A-v1',appVersion:'test'});
  const edited=workspace.initialFeatures.map(row=>({...row,geometry:row.id==='state:A'
    ? polygon(0,1.1):polygon(1.1,2)}));
  const changed=collectLibraryGeometryChanges(workspace,edited);
  assert.deepEqual(changed.map(row=>row.entityId),['state:A','state:B']);
  assert.ok(changed.every(row=>row.geometryVersions[0].validFrom==='1900-01-01'
    && row.geometryVersions[0].validTo==='1900-12-31'));
});

test('regional sources use peer scratch countries and keep original kind and parent on save',async()=>{
  const regional=[entity('region:A',polygon(0,1)),entity('region:B',polygon(1,2)),
    entity('region:Other',polygon(1,2))];
  for(const row of regional){row.entityKind='regional';row.parentEntityId=row.entityId==='region:Other'?'state:Other':'state:Parent';}
  const regionalIndex={entities:regional.map(row=>({entityId:row.entityId,entityKind:row.entityKind,
    parentEntityId:row.parentEntityId,bbox:[0,0,2,1]}))};
  const workspace=await prepareLibraryGeometryWorkspace({index:regionalIndex,
    readEntity:async id=>regional.find(row=>row.entityId===id),entityId:'region:A',
    versionId:'region:A-v1',appVersion:'test'});
  assert.deepEqual(workspace.initialFeatures.map(row=>row.id),['region:A','region:B']);
  assert.ok(workspace.initialFeatures.every(row=>row.properties.entityKind==='general'
    && row.properties.parentId===''));
  assert.deepEqual(workspace.byProjectId.get('region:B'),{entityId:'region:B',versionId:'region:B-v1'});
  const session=new sharedCalculationCore.DocumentSession({validateFlagDataUrl:()=>true});
  const state=session.documentLoad(JSON.stringify(workspace.project),workspace.project.projectSetup.initialMonth);
  assert.deepEqual(session.resolveWorld(state.timelineCursor,state.epoch).entities.map(row=>row.id),
    ['region:A','region:B']);
  const accepted=workspace.initialFeatures.map(row=>row.id==='region:B'
    ? {...row,geometry:polygon(1.1,2)}:row);
  const changed=collectLibraryGeometryChanges(workspace,accepted);
  assert.equal(changed[0].entityKind,'regional');
  assert.equal(changed[0].parentEntityId,'state:Parent');
  assert.equal(changed[0].geometryVersions[0].validFrom,'1900-01-01');
});

test('signed source dates are expanded using the calendar parser, not string length',async()=>{
  const ancient=entity('state:Ancient',polygon(0,1),'-0001','0001');
  const ancientIndex={entities:[{entityId:ancient.entityId,bbox:[0,0,1,1]}]};
  const workspace=await prepareLibraryGeometryWorkspace({index:ancientIndex,
    readEntity:async()=>ancient,entityId:'state:Ancient',versionId:'state:Ancient-v1',appVersion:'test'});
  assert.equal(workspace.referenceDate,'-0001-01-01');
  assert.equal(workspace.project.projectSetup.initialMonth,'-0001-01');
  assert.doesNotThrow(()=>assertCurrentProjectSchema(workspace.project));
});

test('library geometry mode never opens the ordinary project storage', async () => {
  const context={kind:'library-geometry'};
  const assembly=createHistoryAssembly({libraryGeometryContext:context});
  assembly.connect({platformConfigurationA:{},platformConfigurationB:{},
    projectServices:{createBrowserProjectStorage(){throw new Error('ordinary project storage opened');}}});
  const previous=globalThis.window;
  globalThis.window={indexedDB:{},localStorage:{}};
  try { assembly.initializeBrowserProjectStorage(); }
  finally { globalThis.window=previous; }
  assembly.persistenceService.queueProject();
  assembly.persistenceService.queueView();
  assert.deepEqual(await assembly.persistenceService.restore(),{project:null,source:null,view:null,error:null});
});

test('library startup supplies its scratch document without calling autosave restore',async()=>{
  const scratch={format:'pandolab-project-state'};
  const result=await resolveStartupSource({libraryGeometryContext:{prepare:async()=>({project:scratch})},
    restoreAutosave:()=>{throw new Error('ordinary autosave read');}});
  assert.equal(result.project,scratch);
  assert.equal(result.source,'library-geometry');
});

test('library Save commits source geometry without opening the project file writer',async()=>{
  let commits=0;
  const statuses=[];
  await saveBoundDocument({libraryGeometryContext:{save:async()=>{commits++;return {changed:true};}},
    getGisFileController:()=>{throw new Error('project writer opened');},
    setActionStatus:(...args)=>statuses.push(args)});
  assert.equal(commits,1);
  assert.deepEqual(statuses,[['라이브러리 경계를 저장했습니다.','success',3200]]);
});

test('shared Save boundary reports committed source with pending working-file refresh',async()=>{
  const statuses=[];
  const warning={code:'PL-LIBRARY-WORKING-REFRESH',message:'파일이 사용 중입니다'};
  const save=()=>saveBoundDocument({libraryGeometryContext:{save:async()=>({changed:true,warning})},
    getGisFileController:()=>{throw new Error('project writer opened');},
    setActionStatus:(...args)=>statuses.push(args)});
  await save();
  await save();
  assert.deepEqual(statuses,[
    ['라이브러리 경계 저장 완료 · 작업 파일 갱신 대기: 파일이 사용 중입니다','warning',0],
    ['라이브러리 경계 저장 완료 · 작업 파일 갱신 대기: 파일이 사용 중입니다','warning',0],
  ]);
});

test('accepted geometry commits through the existing library editor with its source interval intact',async()=>{
  const base=new URL('../../assets/data/territorial-entities/generated/v2/',import.meta.url);
  const currentIndex=JSON.parse(readFileSync(new URL('index.json',base),'utf8'));
  const receipts=[];
  let revision='r0';
  const repository={
    open:async()=>({revision,index:currentIndex}),
    snapshot:()=>({revision,index:currentIndex}),
    readEntity:async id=>JSON.parse(gunzipSync(readFileSync(new URL(
      currentIndex.entities.find(row=>row.entityId===id).file,base)))),
    commit:async request=>{
      receipts.push(request);revision='r1';return {revision,index:request.index};
    },
  };
  const service=createTerritorialLibraryService({loader:createRepositoryTerritorialLoader(repository)});
  const context=createLibraryGeometryContext({repository,service,entityId:'state:KOR',
    versionId:'state:KOR:natural-earth-5.1.1',appVersion:'test'});
  const workspace=await context.prepare();
  assert.equal(context.title,'라이브러리 경계 편집 · 대한민국');
  let accepted=workspace.initialFeatures;
  let draft={boundaryDraft:null};
  let appState={geometryPreview:{session:null}};
  context.attachRuntime({entityRepository:{list:()=>accepted},projectDomain:{snapshot:()=>workspace.project},
    editingDomain:{snapshot:()=>draft},getState:()=>appState});
  assert.equal(context.hasUnsavedChanges(),false);
  appState={geometryPreview:{session:{id:'preview'}}};
  assert.equal(context.hasUnsavedChanges(),true);
  appState={geometryPreview:{session:null}};
  draft={boundaryDraft:{moveCount:1}};
  assert.equal(context.hasUnsavedChanges(),true);
  draft={boundaryDraft:null};
  accepted=workspace.initialFeatures.map(row=>row.id==='state:KOR'
    ? {...row,geometry:polygon(126,127)}:row);
  assert.equal(context.hasUnsavedChanges(),true);
  const saved=await context.save();
  assert.equal(saved.changed,true);
  assert.equal(context.hasUnsavedChanges(),false);
  assert.equal(receipts.length,1);
  assert.equal(receipts[0].expectedRevision,'r0');
  assert.deepEqual(receipts[0].entities.map(row=>row.entityId),['state:KOR']);
  assert.equal(receipts[0].entities[0].geometryVersions[0].validFrom,null);
  assert.equal(receipts[0].entities[0].geometryVersions[0].validTo,null);
  assert.deepEqual(receipts[0].entities[0].geometryVersions[0].geometry,polygon(126,127));
  assert.equal(receipts[0].entities[0].geometryVersions[0].historicalProvenance.evidenceStatus,'provisional');
  assert.equal(receipts[0].entities[0].geometryVersions[0].historicalProvenance.editMethod,'user-map-editor');
});

test('beforeunload prompts only for unsaved native library geometry',()=>{
  let prevented=0;
  const dirty={preventDefault:()=>{prevented++;},returnValue:undefined};
  assert.equal(confirmLibraryGeometryBeforeUnload(dirty,{hasUnsavedChanges:()=>true}),true);
  assert.equal(prevented,1);
  assert.equal(dirty.returnValue,'');
  const clean={preventDefault:()=>{prevented++;},returnValue:undefined};
  assert.equal(confirmLibraryGeometryBeforeUnload(clean,{hasUnsavedChanges:()=>false}),false);
  assert.equal(prevented,1);
  assert.equal(clean.returnValue,undefined);
});
