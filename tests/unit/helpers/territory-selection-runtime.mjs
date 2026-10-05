// Test-only platform ports; selection, geometry, rivers and preview validation use production modules.
import { runInThisContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const selectionEntrypoints = ['app-territory-selection-workflow','app-territory-components','territory-component-plan','app-country-modes','app-country-commits','app-river-candidates','river-territory-partition','annex-geometry','cut-worker-preparation','map-edit-country-commands','map-edit-preview-calculations','map-edit-geometry','app-cut-geometry','app-land-relations'];
const clone = value => structuredClone(value);
const noop = () => {};
export const square = (x0,y0,x1,y1) => ({ type:'Polygon', coordinates:[[[x0,y0],[x0,y1],[x1,y1],[x1,y0],[x0,y0]]] });
export async function loadSelectionModules(root = sourceRoot) {
  await import(pathToFileURL(resolve(root, 'assets/js/vendor/polygon-clipping.min.js')).href);
  runInThisContext(readFileSync(resolve(root, 'assets/js/vendor/d3.min.js'),'utf8'), {filename:'pinned-d3.min.js'});
  const modules = await Promise.all([...selectionEntrypoints,'territorial-units'].map(name => import(pathToFileURL(resolve(root,`assets/js/modules/${name}.js`)).href)));
  globalThis.window = globalThis;
  return {...Object.assign({}, ...modules), ...globalThis.PandoLabPolygonGeometry, clipper:globalThis.polygonClipping, d3:globalThis.d3};
}
export function seedSelectionFeatures(api, {remote = true, children = false} = {}) {
  const feature = (id, geometry, parentId='', entityKind='general') => api.createTerritorialFeature({id,name:id,entityKind,parentId,coverageMode:parentId?'partition':'explicit',geometry});
  const donor = remote ? {type:'MultiPolygon', coordinates:[square(0,0,10,10).coordinates,square(12,0,14,2).coordinates]} : square(0,0,10,10);
  return [feature('target',square(-5,0,0,10)),feature('donor',donor), ...(children ? [feature('child-left',square(0,0,5,10),'donor'),feature('child-right',square(5,0,10,10),'donor'),feature('independent-region',square(1,1,9,9),'','regional')] : [])];
}
/** All geometry and selection state transitions are production code. The default preview adapter executes the real annex calculator+validator; it never mutates document state. Supply production lifecycle ports to exercise confirmation. */
export function createSelectionRuntime(api, {features=seedSelectionFeatures(api), lifecycle=null, riverFeatures=[]}={}) {
  const state = lifecycle?.state || {territorySelectionSession:null, geometryPreview:{session:null},hydroEdits:[],physicalLoadState:{hydro:'ready'}};
  state.hydroEdits ||= []; state.physicalLoadState ||= {hydro:'ready'};
  const repository = lifecycle?.entityRepository || { get:id => features.find(f=>String(f.id)===String(id)),list:() => features };
  const errors=[], requests=[], previews=[], effects=[]; let draft=[], uid=0;
  const workflow=api.createTerritorySelectionWorkflow(), components=api.createTerritoryComponents(), modes=api.createCountryModes(), commits=api.createCountryCommits(), rivers=api.createRiverCandidates();
  const plan=api.createTerritoryComponentPlan({clipper:api.clipper,normalize:api.normalizePolygonGeometry});
  const calculator=api.createCountryCommandCalculator(api.clipper);
  const worker={ stop(){effects.push('worker.stop');}, async execute(operation,{payload}) {
    requests.push({operation,payload:clone(payload)});
    const method={'territory-components':'prepare','territory-selection':'selection','territory-slivers':'slivers'}[operation];
    if (!method) throw Error(`Unsupported selection operation ${operation}`);
    return {result:await plan[method](payload)};
  }};
  const defaultGeometryOperations={
    discardActiveGeometryPreview(){state.geometryPreview.session=null;effects.push('preview.discard');return true;},
    async beginWorkerGeometryPreview(request){
      const message={operation:request.operation,...request.payload};
      const before=repository.list();
      const calculated=calculator.calculate(message,new Map(before.filter(f=>f.properties.entityKind==='general'&&!f.properties.parentId).map(f=>[String(f.id),f])));
      const preview=api.calculateCountryPreview(message,calculated.result,before,calculated.afterFeatures,api.clipper);
      previews.push({payload:clone(request.payload),result:clone(calculated.result),preview:clone(preview)});
      state.geometryPreview.session=preview; return true;
    },
    async applyActiveGeometryPreview(){throw Error('Read-only session observation cannot apply');},
  };
  const geometryOperations=lifecycle?.geometryPreview || defaultGeometryOperations;
  const editingDomain={ ...(lifecycle?.domains.editingDomain||{}),setTool:tool=>{state.tool=tool;return true;},startDraft:({coords})=>{draft=clone(coords);},replaceDraftCoordinates:coords=>{draft=clone(coords);},clearDraft:()=>{draft=[];},draftInputActive:()=>draft.length>0,cancelActiveGesture:noop,clearDraftHover:noop,refreshTerritorySelection:noop };
  const domains={...(lifecycle?.domains||{}), editingDomain,projectDomain:{...(lifecycle?.domains.projectDomain||{}),getGeneration:()=>7},renderingDomain:lifecycle?.domains.renderingDomain||{}};
  if(lifecycle) Object.assign(lifecycle.domains,domains);
  const ports={...(lifecycle?.ports||{}), projectState:{state}, territorialModel:{...(lifecycle?.ports.territorialModel||{}),...api,entityRepository:repository},platform:{...(lifecycle?.ports.platform||{}),d3:api.d3,polygonClipping:api.clipper,deepClone:clone},
    geometryModel:api,cutGeometry:{normalizeClippedLandGeometry:value=>api.normalizePolygonGeometry(Array.isArray(value)?{type:'MultiPolygon',coordinates:value}:value)},territoryGeometry:components,
    surfaces:{uid:prefix=>`${prefix}-${++uid}`},domains,taskUi:{setModeBanner:noop,updateModeButtons:noop}, feedback:{setActionStatus:noop,reportOperationError:(error,_message,code)=>errors.push({code,message:error.message})},
    objectPresentation:{territorialEntityName:feature=>feature?.properties?.name||feature?.id||''},objectOperationsB:{requireObjectsUnlocked:refs=>refs.every(ref=>!repository.get(ref.id)?.properties?.locked)},
    territoryComponents:components,territoryComponentUi:{updateTerritoryComponentSelectionFeedback:noop},countryEditingA:{editingDraftCoordinates:()=>draft},countryEditingB:modes,countryEditingC:modes,countryCommitFlow:commits,
    geometryOperations,spatialQuery:{...(lifecycle?.ports.spatialQuery||{}),mapEditClient:worker},countryValidation:{refreshCountryCentroids:noop},
    snapshots:lifecycle?.snapshots||{snapshotEditable:()=>clone(features)},territorialServicesA:api,applicationConstantsA:api,riverCandidates:rivers,
    interactionPresentation:{defaultDraftInstruction:()=>''},territorialEditingA:{},territorialEditingB:{},
    territorySelectionA:{activeTerritorySelectionSession:workflow.activeSession,setTerritorySelectionCandidates:workflow.setCurrentCandidates,clearTerritorySelection:workflow.clear},
    geometryPreview:{geometryPolygonSets:components.geometryMultiCoordinates},
    gisServicesA:{ensureGisRuntime:async()=>true},physicalData:{loadHydroData:async()=>true},
    domainControllers:{...(lifecycle?.ports.domainControllers||{}),gisDomain:{cancelRiverPartition:noop,loadRiverPartitionFeatures:async()=>({features:riverFeatures,diagnostics:{fixture:true}}),computeRiverPartition:async payload=>api.buildRiverTerritoryPartitions({...payload,clipper:api.clipper})}},
  };
  const cut=api.createCutGeometry(); const land=api.createLandRelations();
  const actualCut={applyWorkerCountryPatches:cut.applyWorkerCountryPatches,buildCutSplitCandidates(source,coords){
    const result=api.prepareCutInWorker({source,coords,buildPreview:true,view:{kind:'flat',scale:1000,translate:[500,500],rotate:[0,0,0],center:[0,0],snapDistance:{mouse:10,touch:18},coarsePointer:false,size:{width:2000,height:2000}}},api,api.d3,api.clipper);
    effects.push({cutAssessment:clone(result)}); if(!result.valid||!result.split) throw Error(result.message||result.splitError||'Cut failed'); return result.split;
  }};
  ports.cutOperations=actualCut;ports.landRelations=land;ports.geometryMutation={setApplyingWorkerResult:noop};
  cut.connect(ports);land.connect(ports);components.connect(ports);modes.connect(ports);commits.connect(ports);rivers.connect(ports);rivers.initializeRiverPartitionGeneration();workflow.connect(ports);workflow.initializeTerritorySelectionWorkflow();
  return {state,api,workflow,components,commits,ports,features,errors,requests,previews,effects,setDraft:coords=>{draft=clone(coords);},draft:()=>clone(draft),lifecycle};
}
export async function settle(h) {
  const end=Date.now()+10000;
  for(;;){
    await new Promise(resolve=>setTimeout(resolve,5));
    const s=h.workflow.activeSession();
    if(h.errors.length) throw Error(JSON.stringify(h.errors));
    if(!s||(!s.computationPending&&!s.previewPending&&!s.preparation&&!s.workerRequests&&s.riverPartitionStatus!=='loading'))return;
    if(Date.now()>end)throw Error('Selection did not settle');
  }
}
