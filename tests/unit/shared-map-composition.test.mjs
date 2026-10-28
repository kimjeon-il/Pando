import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapOwners} from "../../shared/frontend/js/modules/map-owner-composition.js";
import {createRenderQuality} from "../../shared/frontend/js/modules/render-quality.js";
import {createReadinessNotifications} from "../../apps/editor/frontend/js/modules/app-readiness-notifications.js";

test('both products connect the real picking owner with the canonical scope and live ports',async()=>{
 const {connectMapOwner}=await import('../../shared/frontend/js/modules/map-owner-ports.js');
 for(const productMode of ['viewer','editor']){
  const owners=createMapOwners({productMode});
  let rows=[],queries=0;
  const ports={projectState:{state:{}},objectModelB:{territorialScope:{displayFeature:()=>{queries++;return null;}}},
   platform:{},selectionServices:{normalizeObjectRef:value=>value},objectLookup:{},objectOperationsA:{},territorialModel:{},layerPresentation:{},renderScene:{},
   mapView:{},labelPresentation:{},cutGeometry:{},landRelations:{},spatialRecords:{indexedMapObjectCandidates:()=>rows},hydroModel:{},rendering:{},
   hydroPresentation:{},surfaces:{},physicalServices:{},pointerInteractionA:{},domains:{},mapLayout:{},countries:{},feedback:{}};
  assert.throws(()=>connectMapOwner('objectPicking',owners.objectPicking,{...ports,projectState:undefined}),/objectPicking.*projectState/);
  Object.defineProperty(ports.projectState,'state',{get:()=>({countries:rows})});
  connectMapOwner('objectPicking',owners.objectPicking,ports);
  assert.deepEqual(owners.objectPicking.territorialObjectsAt([0,0]),[]);
  rows=[{domain:'territorial',id:'one'}];
  assert.deepEqual(owners.objectPicking.territorialObjectsAt([0,0]),[]);
  assert.equal(queries,1);
  assert.throws(()=>connectMapOwner('objectPicking',owners.objectPicking,ports),/already connected/);
 }
});

test('missing canonical picking scope is rejected at the common connection boundary',async()=>{
 const {connectMapOwner,MAP_OWNER_REQUIRED_PORTS}=await import('../../shared/frontend/js/modules/map-owner-ports.js');
 const ports=Object.fromEntries(MAP_OWNER_REQUIRED_PORTS.objectPicking.map(name=>[name,{}]));
 assert.throws(()=>connectMapOwner('objectPicking',createMapOwners({productMode:'viewer'}).objectPicking,ports),/territorialScope/);
});

test('common connection preserves late platform accessors until their owner is initialized',async()=>{
 const {connectMapOwner,MAP_OWNER_REQUIRED_PORTS}=await import('../../shared/frontend/js/modules/map-owner-ports.js');
 const ports=Object.fromEntries(MAP_OWNER_REQUIRED_PORTS.workspaceSurfaces.map(name=>[name,{}]));
 let navigation,reads=0,connected;
 Object.defineProperty(ports,'mapNavigation',{enumerable:true,get(){reads++;if(!navigation)throw Error('not initialized');return navigation;}});
 connectMapOwner('workspaceSurfaces',{connect:value=>{connected=value;}},ports);
 assert.equal(reads,0);
 navigation={move(){}};
 assert.equal(connected.mapNavigation,navigation);
 assert.equal(reads,1);
});

test('common catalog ports observe sources installed after dependency connection',async()=>{
 const {connectMapOwner,MAP_OWNER_REQUIRED_PORTS}=await import('../../shared/frontend/js/modules/map-owner-ports.js');
 const ports=Object.fromEntries(MAP_OWNER_REQUIRED_PORTS.objectCatalog.map(name=>[name,{}]));
 let connected;
 connectMapOwner('objectCatalog',{connect:value=>{connected=value;}},ports);
 ports.countries={builtinTerritorialScene:{features:[]}};
 assert.equal(connected.countries,ports.countries);
});

test('readonly owner graph rejects editor capability registration before constructing any state',()=>{
 assert.throws(()=>createMapOwners({productMode:'viewer',editing:{persistView(){}}}),/cannot register editing/);
 const owners=createMapOwners({productMode:'viewer',isObjectAvailable:()=>true});
 assert.equal(owners.projectSession.saveState,undefined);
 assert.equal(typeof owners.projectSession.setViewingPresentation,'function');
});

test('canonical mesh completion ignores a superseded document generation',async()=>{
 let generation=1,complete;const events=[];
 const owner=createRenderQuality();owner.connect({rendering:{gpuMapRenderer:{getProjectGeneration:()=>generation,
   rebuildFromCountries:()=>new Promise(resolve=>{complete=resolve;}),syncCountryMeshQuality:()=>events.push('quality')}},
   projectState:{state:{}},domains:{renderingDomain:{invalidateProject:()=>events.push('render')}}});
 const pending=owner.prepareCanonicalMesh({features:[]});generation=2;complete(true);
 assert.equal(await pending,false);assert.deepEqual(events,[]);
});

test('notification output resolves initialized platform ports when used',()=>{
 const owner=createReadinessNotifications(),platform={};
 owner.connect({platform,surfaces:{isMobile:()=>false}});
 platform.$=()=>null;assert.doesNotThrow(()=>owner.setActionStatus('준비','working',0));
});

test('common read ports preserve canonical scope and current sources across product project replacement',async()=>{
 const {createMapReadPorts,mergeCapabilityPorts,connectMapOwner}=await import('../../shared/frontend/js/modules/map-owner-ports.js');
 assert.equal(typeof createMapReadPorts,'function');
 for(const productMode of ['viewer','editor']){
  const owners=createMapOwners({productMode});let queries=0,rows=[];
  let scope={displayFeature:()=>{queries++;return null;}};
  const projectSession={state:{}};
  const common=createMapReadPorts({...owners,projectSession,objectPresentation:{get territorialScope(){return scope;}}});
  const ports=mergeCapabilityPorts(common,{platform:{},selectionServices:{normalizeObjectRef:value=>value},objectLookup:{},objectOperationsA:{},territorialModel:{},layerPresentation:{},renderScene:{},
   labelPresentation:{},cutGeometry:{},landRelations:{},spatialRecords:{indexedMapObjectCandidates:()=>rows},rendering:{},
   hydroModel:{},hydroPresentation:{},physicalServices:{},pointerInteractionA:{},domains:{},mapLayout:{},feedback:{}});
  connectMapOwner('objectPicking',owners.objectPicking,ports);
  rows=[{domain:'territorial',id:'one'}];
  assert.deepEqual(owners.objectPicking.territorialObjectsAt([0,0]),[]);assert.equal(queries,1);
  assert.equal(ports.objectModelB.territorialScope,scope);
  assert.equal(ports.projectState.state,projectSession.state);
  scope={displayFeature:()=>{queries+=10;return null;}};
  projectSession.state={countryVisualPhase:'pending'};
  assert.equal(ports.projectState.state,projectSession.state);
  assert.equal(ports.objectModelB.territorialScope,scope);
  assert.deepEqual(owners.objectPicking.territorialObjectsAt([0,0]),[]);assert.equal(queries,1);
  projectSession.state={countryVisualPhase:'canonical'};
  assert.deepEqual(owners.objectPicking.territorialObjectsAt([0,0]),[]);assert.equal(queries,11);
  rows=[];assert.deepEqual(owners.objectPicking.territorialObjectsAt([0,0]),[]);assert.equal(queries,11);
 }
});

test('common query initialization installs one live scope and presentation caches',async()=>{
 const {initializeMapReadOwners}=await import('../../shared/frontend/js/modules/map-owner-composition.js');
 const {MAP_OBJECT_CATEGORIES,MAP_OBJECT_TYPES}=await import('../../shared/frontend/js/modules/map-object-categories.js');
 const owners=createMapOwners({productMode:'viewer'});let entities=[];
 owners.objectPresentation.connect({platform:{polygonClipping:{}},projectState:{state:{}},territorialModel:{entityRepository:{list:()=>entities,get:id=>entities.find(row=>row.id===id)}},objectDefinitions:{MAP_OBJECT_CATEGORIES,MAP_OBJECT_TYPES}});
 initializeMapReadOwners(owners,'queries');
 assert.deepEqual(owners.objectPresentation.territorialScope.displayEntities(),[]);
 entities=[{id:'A',properties:{entityKind:'general'},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[0,1],[0,0]]]}}];
 assert.equal(owners.objectPresentation.territorialScope.displayEntities()[0],entities[0]);
 assert.equal(owners.objectPresentation.distributionVisibilityRevision,0);
 assert.equal(owners.objectPresentation.distributionRenderRowCache.rebuildCount,0);
 assert.throws(()=>initializeMapReadOwners(owners,'queries'),/already initialized/);
});

test('shared rendering resources retain one frame snapshot and the canonical selection geometry',async()=>{
 const {createMapRenderingResources}=await import('../../shared/frontend/js/modules/map-renderer-composition.js');
 assert.equal(typeof createMapRenderingResources,'function');
 const entity={id:'A'},selection={snapshot:()=>({selection:{items:[]}}),has:()=>false};
 const ports=Object.fromEntries(['platform','countryLabelModel','pointerInteractionA','objectPicking','objectPresentation','applicationServicesB','surfaces','labelPresentation','genericEditingA','mapLayout','mapLayers','layerPresentation','renderScene','preferences','gpuRenderingA','gpuRenderingB','physicalResources','hydroPresentation','spatialQuery','spatialRecords','physicalServices','selectionServices','builtinCountries','territorialEditingB','objectModelB','genericEditingB','presentation','colorModel','distributionServices','territorialModel','applicationConstantsA','objectModelA','countries','territorialServicesA','interactionPresentation','projectionView','applicationServicesA','objectOperationsA','geometryOperations','interactionStateCommands','rendering'].map(key=>[key,{}]));
 ports.projectState={state:{stateRevision:1}};const session={selectionDomain:selection};
 ports.distributionPresentation={};
 ports.countryLabelModel.renderPendingCountryOverlays=()=>assert.fail('editor SVG preview must not enter viewer rendering');
 ports.territorialModel.entityRepository={get:()=>entity};
 ports.objectModelB.territorialScope={displayFeature:()=>entity};
 let layer={id:'old'},reads=0;
 const layers={get selectionLayer(){reads++;return layer;}};
 const resources=createMapRenderingResources({ports,layers,session});
 assert.equal(resources.territorialResources.selectionHas({id:'A'}),false);
 assert.equal(resources.countryResources.renderPendingCountryOverlays,undefined);
 const initial=reads;layer={id:'new'};
 resources.refreshRenderResources(1);assert.equal(resources.selectionResources.selectionLayer,layer);
 const first=reads;resources.refreshRenderResources(1);assert.equal(reads,first);
 layer={id:'newer'};resources.refreshRenderResources(2);assert.equal(resources.selectionResources.selectionLayer,layer);
 assert.ok(first>initial);assert.equal(resources.selectionResources.territorialDisplayFeature('A'),entity);
 assert.equal(resources.selectionResources.activeEditPreview,undefined);
});
