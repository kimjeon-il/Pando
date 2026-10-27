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
