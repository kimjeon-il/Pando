import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {loadWebOracle} from './web-oracle.mjs';

const root=new URL('../fixtures/portability/web-9300609-removal-oracle/',import.meta.url);
const mainRoot=new URL('../fixtures/portability/web-9300609-oracle/',import.meta.url);
const baseline='930060923889d17134e36e152c29f4adbb2e60a9';
let admitted;
const moduleUrl=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const redirect=(text,path,target)=>{
  if(!text.includes(`'${path}'`))throw new Error(`Original removal import changed: ${path}`);
  return text.replaceAll(`'${path}'`,JSON.stringify(target));
};
async function admit() {
  const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  if(manifest.schema!=='pandoeditor-web-removal-test-oracle'||manifest.baseline!==baseline)throw new Error('Removal oracle baseline changed.');
  const sources=new Map();
  for(const row of [...manifest.files,...manifest.fixtures]) {
    if(!/^[\w./-]+$/u.test(row.path)||row.path.split('/').includes('..'))throw new Error('Invalid removal oracle path.');
    const bytes=await readFile(new URL(row.path,root));
    if(createHash('sha256').update(bytes).digest('hex')!==row.sha256||
      (row.blob&&createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')!==row.blob))throw new Error(`Removal oracle bytes changed: ${row.path}`);
    sources.set(row.path,bytes.toString('utf8'));
  }
  await loadWebOracle('assets/js/modules/territorial-units.js');
  const policy=moduleUrl(sources.get('assets/js/modules/builtin-territory-policy.js'));
  const builtin=moduleUrl(redirect(redirect(sources.get('assets/js/modules/builtin-subunits.js'),'./territorial-units.js',new URL('assets/js/modules/territorial-units.js',mainRoot).href),'./builtin-territory-policy.js',policy));
  const deletion=moduleUrl(redirect(sources.get('assets/js/modules/territorial-interaction-policy.js'),'./builtin-subunits.js',builtin));
  const place=moduleUrl(sources.get('assets/js/modules/place-contract.js'));
  const commands=moduleUrl(redirect(redirect(redirect(sources.get('assets/js/modules/app-object-commands.js'),'./place-contract.js',place),'./territorial-interaction-policy.js',deletion),'./territorial-edit-plan.js',new URL('assets/js/modules/territorial-edit-plan.js',mainRoot).href));
  return {factory:(await import(commands)).createObjectCommands,input:JSON.parse(sources.get('input.json')),expected:JSON.parse(sources.get('expected.json'))};
}

/** Exact original UI factory/store/history/serializer; platform publication is inert. */
export async function captureOriginalLinkedLabelRemoval() {
  const {factory,input,expected}=await(admitted??=admit());
  const {createCommandFixture}=await loadWebOracle('tools/parity/command-history.mjs');
  const {prepareProjectForStorage}=await loadWebOracle('assets/js/modules/project-state.js');
  const {validateProjectReferenceIntegrity}=await loadWebOracle('assets/js/modules/project-invariants.js');
  const {createProjectSerializer}=await loadWebOracle('assets/js/modules/project-serializer.js');
  const {createHistoryService}=await loadWebOracle('assets/js/modules/history-service.js');
  const {normalizeObjectRef}=await loadWebOracle('assets/js/modules/object-selection-controller.js');
  const seed=structuredClone(input);prepareProjectForStorage(seed);
  const {state,store,repository,service}=createCommandFixture();
  Object.assign(state,Object.fromEntries(Object.entries(structuredClone(seed)).filter(([key])=>!['territorialEntities','timelineRecords','geometries'].includes(key))),{stateRevision:0});store.restoreProject(seed);
  const full=()=>({...structuredClone(seed),...Object.fromEntries(Object.keys(seed).filter(k=>!['territorialEntities','timelineRecords','geometries'].includes(k)).map(k=>[k,structuredClone(state[k])])),territorialEntities:store.identities(),timelineRecords:structuredClone(state.timelineRecords),geometries:state.geometries.snapshot()});
  const history=createHistoryService({store:{history:[],historyMeta:[],future:[],futureMeta:[]},snapshot:full,restore:()=>{},normalizeMetadata:x=>x});
  let confirm,autosaves=0;const errors=[];
  const owner=factory();owner.connect({projectState:{state},selectionServices:{normalizeObjectRef},domains:{projectDomain:{getGeneration:()=>1,commitHistorySnapshot:history.commitSnapshot,queueAutosave:()=>++autosaves},selectionUiController:{clear:()=>{}},renderingDomain:{}},territorialModel:{entityStore:store,entityRepository:repository,DISTRIBUTION_MODES:{TERRITORIAL:'territorial'}},objectModelB:{territorialApplicationService:service},objectPresentation:{territorialEntityName:f=>f.properties.name},snapshots:{snapshotEditable:()=>prepareProjectForStorage(full())},projectRestore:{openConfirmModal:options=>{confirm=options.onConfirm;}},hydroPresentation:{hydroEditById:()=>null},hydroModel:{hydroFeatureById:()=>null},landRelations:{reassignGenericFeatureParents:()=>{}},rendering:{gpuMapRenderer:{invalidateHydroVisibility:()=>{}}},layers:{markLayerTreeDirty:()=>{}},spatialQuery:{markCountryGeometriesChanged:()=>{}},projectSnapshots:{restoreEditable:()=>{}},feedback:{setActionStatus:()=>{},reportOperationError:error=>errors.push(error.message)}});
  const requested=owner.requestObjectDeletion([{domain:'territorial',type:'entity',id:'A'}]);const applied=confirm();
  const after=full();let schemaError=null,serializerError=null;
  try{prepareProjectForStorage(after);}catch(error){schemaError={code:error.code,message:error.message};}
  const fields=Object.fromEntries(Object.entries(after).filter(([key])=>!['format','schemaVersion','version','savedAt','baseDataset','landObjectModel','territorialModel','distributionModel','territorialEntities'].includes(key)));
  const serializer=createProjectSerializer({appVersion:'test',baseDataset:'tiny',distributionModes:['territorial','geometry'],terrainDataset:'terrain',hydroDataset:'hydro',readSnapshot:()=>({territorialEntities:after.territorialEntities,projectFields:fields,fullAutosave:true})});
  let savedLabel;try{savedLabel=serializer.buildProject().labels[0];}catch(error){serializerError={code:error.code,message:error.message};}
  return {expected,result:{requested,applied,stateRevision:state.stateRevision,undo:history.canUndo(),autosaves,remainingIds:store.identities().map(r=>r.id),label:state.labels[0],invariants:validateProjectReferenceIntegrity({...after,storageOnly:true}),schemaError,serializerError,savedLabel,errors}};
}
