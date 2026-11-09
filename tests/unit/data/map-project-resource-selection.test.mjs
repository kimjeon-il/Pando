import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMapProjectResourceSelection} from '../../../src/data/map-project-resource-selection.js';
import {createPhysicalResources} from '../../../src/data/physical-resources.js';
import {createTerritorialLabels} from '../../../src/rendering/territorial-labels.js';

const project=JSON.parse(readFileSync(
  new URL('../../../projects/default-world/manifest.json',import.meta.url),'utf8'));
const territorial=project.resources.territorial.catalog;
function fixture(){
  const receipts=Object.fromEntries(Object.entries(project.resources).map(([role,entry])=>[
    role,{catalog:entry.catalog,sha256:'a'.repeat(64)}]));
  const meta={mapProject:project,mapProjectCatalogs:receipts,dataRevision:'data-fixture',
    builtinWorld:{url:territorial,sha256:'a'.repeat(64)},
    physicalLand:{sha256:'land'},initialLandPreview:{url:'preview.bin',sourceSha256:'land'},
    physicalWaterObjects:{identities:[],geometries:[],timelineRecords:{schemaVersion:3,
      lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]}}};
  const source=documentId=>({projectId:project.projectId,documentId,manifest:project,
    dataRevision:meta.dataRevision,catalogSha256:meta.builtinWorld.sha256,
    scope:{documentKey:project.projectId+'@'+documentId}});
  return {meta,source,selection:createMapProjectResourceSelection({buildMeta:meta})};
}

test('project reference catalogs belong to the active C++ document, not the Viewer build',()=>{
 const {selection,source}=fixture();
 assert.equal(selection.current().projectId,'default-world');
 assert.equal(selection.current().documentId,null,'bootstrap is not an admitted document');
 assert.equal(selection.resource('rivers').catalog,project.resources.rivers.catalog);
 assert.equal(selection.resource('rivers').catalog,selection.resource('lakes').catalog);
 assert.equal(selection.select(source('doc-a')),true);
 const first=selection.revision();
 assert.equal(selection.resource('terrain').documentId,'doc-a');
 assert.equal(selection.select(source('doc-a')),false,'same document does not reset caches');
 assert.equal(selection.select(source('doc-b')),true);
 assert.equal(selection.revision(),first+1);
 assert.equal(selection.select(null),true,'a detached file has no builtin sources');
 for(const role of Object.keys(project.resources))assert.equal(selection.resource(role),null);
 assert.equal(selection.current(),null);
 assert.throws(()=>selection.select({...source('forged'),catalogSha256:'b'.repeat(64)}),
   /selection differs/);
 assert.equal(selection.current(),null,'invalid source does not mutate active selection');
 assert.equal(selection.select(source('doc-a')),true);
});
test('physical land, water, Hydro and terrain resource states retire on C++ project swap',async()=>{
 const {selection,meta,source}=fixture(),resets=[];
 const state={hydroFeatureCache:new Map([['old',{id:'old'}]]),hydroFeatureByFid:new Map([[1,'old']]),
  hydroFragmentsByLogicalId:new Map([['old',[]]]),hydroManifest:{old:true},
  terrainManifest:{old:true},physicalLoadState:{terrain:'ready',hydro:'ready'}};
 let hydroManifestUrl=null,terrainManifestUrl=null;
 const physical=createPhysicalResources({buildMeta:meta,projectResources:selection});
 physical.connect({projectState:{state},rendering:{gpuMapRenderer:{
  setTerrainManifest:manifest=>resets.push(['terrain',manifest]),
  setHydroManifest:(manifest,url)=>{resets.push(['hydro',manifest,url]);return Promise.resolve(false);},
 }},physicalConfig:{PHYSICAL_DATA_BASE_URL:new URL('https://example.test/assets/data/'),
  HYDRO_DATA_VERSION:'0.13.4',DATA_REVISION:'data-fixture',
  TERRAIN_PRIMARY_MANIFEST_URL:new URL('https://example.test/official.json'),
  TERRAIN_FALLBACK_MANIFEST_URL:new URL('https://example.test/raster.json'),
  TERRAIN_SOURCE_CHOICE:'official'},physicalServices:{
  createTerrainService:options=>({load:async()=>{terrainManifestUrl=options.manifestUrl();return true;}}),
  createHydroService:options=>({load:async()=>{hydroManifestUrl=options.manifestUrl();return true;}}),
  fetchWithRetry:async()=>{},
 }});
 physical.initializeTerrainService();
 assert.equal(selection.select(null),true);
 assert.equal(physical.selectProjectResources(),true);
 assert.equal(physical.physicalLand,null);
 assert.equal(physical.physicalLandSourceRevision,null);
 assert.equal(physical.physicalContextState.ready,false);
 assert.equal(state.hydroFeatureCache.size,0);
 assert.equal(state.hydroFeatureByFid.size,0);
 assert.equal(state.hydroManifest,null);
 assert.equal(state.terrainManifest,null);
 assert.deepEqual(resets.map(row=>row[0]),['terrain','hydro']);
 assert.equal(await physical.loadHydroData(true),false);
 assert.equal(selection.select(source('doc-new')),true);
 assert.equal(physical.selectProjectResources(),true);
 assert.equal(await physical.loadHydroData(true),true);
 assert.equal(hydroManifestUrl.pathname,'/assets/data/hydro/v0.13.4/manifest.json');
 assert.equal(await physical.loadTerrainManifest(),true);
 assert.equal(terrainManifestUrl.pathname,'/official.json');
});
test('place references and retained worker scope are retired when no project source is selected',()=>{
 const {selection,source}=fixture();
 const labels=createTerritorialLabels({projectResources:selection});
 labels.connect({platform:{runtimeAssetUrl:path=>new URL('https://example.test/assets/js/'+path)},
  projectState:{state:{timelineCursor:'2014-01'}},
  preferences:{userPreferences:{labels:{place:{languages:{ko:true}}}}},
  domains:{projectDomain:{admitSelectionCatalog:async()=>{}},
   selectionDomain:{snapshot:()=>({selection:{items:[],primaryKey:null}})},
   objectSearchController:{render:()=>{}},renderingDomain:{invalidateLabels:()=>{}}},
  feedback:{reportOperationError:()=>{}}});
 labels.initializeLabelLayoutMetrics();
 assert.equal(selection.select(null),true);
 assert.equal(labels.selectProjectResources(),true);
 assert.deepEqual(labels.builtinPlaceSelectionReferences(),[]);
 assert.deepEqual(labels.builtinPlaces.snapshot().records,[]);
 assert.equal(labels.builtinPlaces.resolve('old-place'),null);
 assert.equal(selection.select(source('doc-reopened')),true);
 assert.equal(labels.selectProjectResources(),true);
 assert.deepEqual(labels.builtinPlaceSelectionReferences(),[]);
 labels.builtinPlaces.dispose();
});

test('Viewer map search resolves the live place worker after a project switch',()=>{
 const source=readFileSync(new URL('../../../src/app/viewer-map.js',import.meta.url),'utf8');
 assert.match(source,/const places=\(\)=>labelOwner\.builtinPlaces;/);
 assert.match(source,/cancelSearch:\(\)=>places\(\)\.cancelSearch\(\)/);
 assert.match(source,/searchPlaces:query=>places\(\)\.search\(query\)/);
 assert.match(source,/searchActive:\(\)=>places\(\)\.isSearchOpen\(\)/);
 assert.doesNotMatch(source,/const places=labelOwner\.builtinPlaces;/);
});
