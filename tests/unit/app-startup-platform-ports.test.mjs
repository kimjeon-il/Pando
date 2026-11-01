import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalResources } from "../../shared/frontend/js/modules/physical-resources.js";
import { createTerritorialLabels } from "../../shared/frontend/js/modules/territorial-labels.js";
import {createPlatformPorts,PLATFORM_PORTS_SCHEMA} from "../../shared/frontend/js/modules/platform-ports.js";
import {createHash} from 'node:crypto';

test('physical resources use their injected pinned metadata instead of a later global change',async t=>{
  const bytes=Buffer.from(JSON.stringify({type:'MultiPolygon',coordinates:[[[[0,0],[0,1],[1,1],[0,0]]]]}));
  const meta={dataRevision:'fixture',physicalWaterObjects:{identities:[],geometries:[]},physicalLand:{url:'assets/data/land.json',encoding:'identity',compressedBytes:bytes.length,decodedBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
  const previous=globalThis.PANDOLAB_BUILD_META;globalThis.PANDOLAB_BUILD_META={dataRevision:'other'};
  t.after(()=>{globalThis.PANDOLAB_BUILD_META=previous;});
  t.mock.method(globalThis,'fetch',async url=>{assert.equal(String(url),'https://fixture.test/land.json');return new Response(bytes);});
  const owner=createPhysicalResources({capabilities:{terrain:false,builtinHydro:false},buildMeta:meta});
  owner.connect({projectState:{state:{timelineCursor:''}},physicalConfig:{PHYSICAL_DATA_BASE_URL:'https://fixture.test/'},domains:{renderingDomain:{invalidateProject(){}}},feedback:{reportOperationError:error=>{throw error;}}});
  await owner.loadPhysicalLandMask();assert.equal(owner.physicalLand.revision,meta.physicalLand.sha256);
});

test('runtime configuration validates one metadata identity and explicit platform ports for both products',async()=>{
  const {createRuntimeContext}=await import('../../shared/frontend/js/modules/runtime-context.js');
  assert.equal(typeof createRuntimeContext,'function');
  const meta={appVersion:'0.36.0',buildId:'test-build',assetRevision:'asset-one',dataRevision:'data-one'};
  for(const productMode of ['viewer','editor']){
    const platform=createPlatformPorts({kind:'browser',resources:{builtinHydro:false,builtinPlaces:true}});
    const context=createRuntimeContext({productMode,meta,assetBaseUrl:'https://fixture.test/assets/js/',platform});
    assert.equal(context.meta,meta);assert.equal(Object.isFrozen(meta),true);
    assert.equal(context.platform,platform);assert.equal(context.platform.schema,PLATFORM_PORTS_SCHEMA);
    assert.equal(Object.isFrozen(context.platform.resources),true);assert.equal(context.platform.resources.builtinHydro,false);
    assert.equal(context.assetUrl('../css/ui.bundle.css?keep=1&v=old').href,'https://fixture.test/assets/css/ui.bundle.css?keep=1&v=asset-one');
  }
  assert.throws(()=>createRuntimeContext({productMode:'viewer',meta,assetBaseUrl:'https://fixture.test/',platform:{builtinHydroAvailable:false}}),/platform|schema/i);
  assert.throws(()=>createRuntimeContext({productMode:'other',meta,assetBaseUrl:'https://fixture.test/'}),/product mode/);
  for(const key of ['appVersion','buildId','assetRevision','dataRevision']){
    assert.throws(()=>createRuntimeContext({productMode:'viewer',meta:{...meta,[key]:''},assetBaseUrl:'https://fixture.test/',platform:createPlatformPorts({kind:'browser'})}),new RegExp(key));
  }
});

test('native editor contract requires storage and the full file-access port',async()=>{
  const {createRuntimeContext}=await import('../../shared/frontend/js/modules/runtime-context.js');
  const meta={appVersion:'0.36.0',buildId:'native-test',assetRevision:'asset-one',dataRevision:'data-one'};
  const missingFiles=createPlatformPorts({kind:'native',storage:{namespace:'native-test'}});
  assert.throws(()=>createRuntimeContext({productMode:'editor',meta,assetBaseUrl:'https://fixture.test/',platform:missingFiles}),/file access/i);
  const access=Object.freeze({openProjectFile(){},openGisFiles(){},prepareProjectSave(){},saveExportFile(){}});
  const platform=createPlatformPorts({kind:'native',storage:{namespace:'native-test'},files:{access}});
  const context=createRuntimeContext({productMode:'editor',meta:{...meta},assetBaseUrl:'https://fixture.test/',platform});
  assert.equal(context.platform.files.access,access);assert.equal(context.platform.storage.namespace,'native-test');
  assert.throws(()=>createPlatformPorts({kind:'browser',builtinHydroAvailable:false}),/unsupported field/i);
});

test('unsupported terrain and hydro make no requests while pinned base land remains required', async () => {
  const resources = createPhysicalResources({ capabilities: {terrain:false,builtinHydro:false} });
  const errors=[];
  resources.connect({feedback:{reportOperationError:error=>errors.push(error)}});
  assert.equal(await resources.loadTerrainManifest(), false);
  assert.equal(await resources.loadHydroData(), false);
  assert.equal(await resources.loadPhysicalData(),false);
  assert.match(errors[0].message,/Missing pinned physical land/);
});

test('an asset-free platform suppresses automatic place preparation', async () => {
  const labels = createTerritorialLabels({ capabilities: {builtinPlaces:false} });
  assert.equal(await labels.preparePlaces({ force: true }), false);
});
