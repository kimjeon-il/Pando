import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceCapabilities} from "../../shared/frontend/js/modules/resource-capabilities.js";
import {createPhysicalResources} from "../../shared/frontend/js/modules/physical-resources.js";
import {createHash} from 'node:crypto';
test('editor disables terrain construction and starts builtin hydro only on request',async t=>{
  const bytes=Buffer.from(JSON.stringify({type:'MultiPolygon',coordinates:[]}));
  const previous=globalThis.PANDOLAB_BUILD_META;t.after(()=>{globalThis.PANDOLAB_BUILD_META=previous;});
  globalThis.PANDOLAB_BUILD_META={dataRevision:'fixture',physicalLand:{url:'assets/data/land.json',encoding:'identity',compressedBytes:bytes.length,decodedBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
  t.mock.method(globalThis,'fetch',async url=>{assert.equal(String(url),'https://fixture.invalid/land.json');return new Response(bytes);});
  const capabilities=resourceCapabilities('editor',{builtinHydroAvailable:true,builtinPlacesAvailable:true});
  assert.equal(capabilities.terrain,false);assert.equal(capabilities.eagerBuiltinHydro,false);
  let terrain=0,hydro=0,loads=0;
  const resources=createPhysicalResources({capabilities});
  resources.connect({physicalServices:{createTerrainService(){terrain++;throw Error('terrain must not initialize');},createHydroService(){hydro++;return {load:async()=>{loads++;return true;}};}},physicalConfig:{PHYSICAL_DATA_BASE_URL:'https://fixture.invalid/'},projectState:{state:{}},domains:{renderingDomain:{invalidateProject:()=>{}}},feedback:{reportOperationError:error=>{throw error;}}});
  resources.initializeTerrainService();
  assert.equal(terrain,0);assert.equal(hydro,1);
  await resources.loadPhysicalData();assert.equal(loads,0);
  assert.equal(resources.physicalLand.geometry.type,'MultiPolygon');
  await resources.loadHydroData(true);assert.equal(loads,1);
  assert.equal(await resources.loadTerrainManifest(true),false);
});
test('web retains backgrounds, small project exposes no unavailable builtins',()=>{
  assert.equal(resourceCapabilities('viewer').terrain,true);
  assert.equal(resourceCapabilities('viewer').eagerBuiltinHydro,true);
  const small=resourceCapabilities('editor',{builtinHydroAvailable:false,builtinPlacesAvailable:false});
  assert.equal(small.builtinHydro,false);assert.equal(small.builtinPlaces,false);
});
