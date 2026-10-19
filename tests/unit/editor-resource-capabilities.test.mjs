import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceCapabilities} from '../../assets/js/modules/resource-capabilities.js';
import {createPhysicalResources} from '../../assets/js/modules/physical-resources.js';
test('editor disables terrain construction and starts builtin hydro only on request',async()=>{
  const capabilities=resourceCapabilities('editor',{builtinHydroAvailable:true,builtinPlacesAvailable:true});
  assert.equal(capabilities.terrain,false);assert.equal(capabilities.eagerBuiltinHydro,false);
  let terrain=0,hydro=0,loads=0;
  const resources=createPhysicalResources({capabilities});
  resources.connect({physicalServices:{createTerrainService(){terrain++;throw Error('terrain must not initialize');},createHydroService(){hydro++;return {load:async()=>{loads++;return true;}};}},physicalConfig:{},projectState:{state:{}}});
  resources.initializeTerrainService();
  assert.equal(terrain,0);assert.equal(hydro,1);
  await resources.loadPhysicalData();assert.equal(loads,0);
  await resources.loadHydroData(true);assert.equal(loads,1);
  assert.equal(await resources.loadTerrainManifest(true),false);
});
test('web retains backgrounds, small project exposes no unavailable builtins',()=>{
  assert.equal(resourceCapabilities('viewer').terrain,true);
  assert.equal(resourceCapabilities('viewer').eagerBuiltinHydro,true);
  const small=resourceCapabilities('editor',{builtinHydroAvailable:false,builtinPlacesAvailable:false});
  assert.equal(small.builtinHydro,false);assert.equal(small.builtinPlaces,false);
});
