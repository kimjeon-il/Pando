import { describe as featureDescribe } from 'node:test';
import * as __suiteDependency0 from "node:assert/strict";
import * as __suiteDependency1 from "node:test";
import * as __suiteDependency2 from "../../tools/gis/hydro-river-features.mjs";
import * as __suiteDependency3 from "node:assert/strict";
import * as __suiteDependency4 from "node:test";
import * as __suiteDependency5 from "../../tools/gis/hydro-lake-features.mjs";
import * as __suiteDependency6 from "node:assert/strict";
import * as __suiteDependency7 from "node:fs/promises";
import * as __suiteDependency8 from "node:os";
import * as __suiteDependency9 from "node:path";
import * as __suiteDependency10 from "node:test";
import * as __suiteDependency11 from "../../tools/gis/hydro-calibration-input.mjs";
import * as __suiteDependency12 from "node:test";
import * as __suiteDependency13 from "node:assert/strict";
import * as __suiteDependency14 from "../../shared/frontend/js/modules/physical-resources.js";
import * as __suiteDependency15 from "../../shared/frontend/js/modules/geometry-version-store.js";
import "../../shared/frontend/js/vendor/polygon-clipping.min.js";

// Original feature contract: hydro-river-features.test.mjs
featureDescribe("hydro-river-features", () => {
  const assert = __suiteDependency0.default;
  const test = __suiteDependency1.default;
  const { buildHydroRiverFeatures } = __suiteDependency2;
test('river feature assembly preserves split source IDs, stage fragments and terminal metadata',
  {skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const reach=(parts,borderPair,terminalClass='')=>({id:10,next:0,mainRiver:10,upstreamArea:100,flow:1,stage:3,
      borderPair,width:1,endWidth:2,renderSnap:null,terminalClass,originalEndpoint:[3,0],parts:[parts]}),chains=[[
      reach([[0,0],[1,0]],null),reach([[1,0],[2,0]],['AAA','BBB']),reach([[2,0],[3,0]],null,'sea')]];
    const result=await buildHydroRiverFeatures({chains,borders:[],neNames:{0:'Test River'},aliases:{},systemOverrides:{},
      independentDocument:{schemaVersion:1,replacements:[]},osmRows:[],fidStart:4,logicalFidStart:8},
    {connectivity:{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY}});
    assert.equal(result.nextFid,7);assert.equal(result.nextLogicalFid,9);assert.equal(result.features.length,3);
    assert.deepEqual(result.features.map(row=>[row.metadata.fid,row.metadata.logicalFid,row.metadata.sourceId,row.metadata.flags]),
      [[4,8,'10',0],[5,8,'10',1],[6,8,'10',0]]);
    assert.deepEqual(result.features.map(row=>row.geometry.coordinates),[[[0,0],[1,0]],[[1,0],[2,0]],[[2,0],[3,0]]]);
    assert.equal(result.features[0].metadata.name,'Test');assert.equal(result.features[1].metadata.source,'HydroRIVERS 1.0 · Natural Earth border AAA/BBB');
    assert.deepEqual(result.features[2].metadata.terminal,{class:'sea',sourceEndpoint:[3,0],renderEndpoint:[3,0]});
  });
});
// Original feature contract: hydro-lake-features.test.mjs
featureDescribe("hydro-lake-features", () => {
  const assert = __suiteDependency3.default;
  const test = __suiteDependency4.default;
  const { buildHydroLakeFeatures } = __suiteDependency5;
test('Natural Earth lake features preserve names, stages and source identity',
  {skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const polygon={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]},lakes=[
      {id:'lake-a',properties:{name_ko:'테스트 호수',min_zoom:6,source_id:'A'},geometry:polygon},
      {id:'lake-b',properties:{name_en:'Blue Lake',min_zoom:7},geometry:polygon},
      {id:'skip',properties:{},geometry:{type:'Point',coordinates:[0,0]}}];
    const result=await buildHydroLakeFeatures({lakes,aliases:{},fidStart:4,logicalFidStart:8},
      {directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});
    assert.equal(result.nextFid,6);assert.equal(result.nextLogicalFid,10);assert.equal(result.features.length,2);
    assert.deepEqual(result.features.map(row=>[row.metadata.fid,row.metadata.logicalFid,row.metadata.name,row.metadata.stage,row.metadata.sourceId]),
      [[4,8,'테스트호수',0,'A'],[5,9,'Blue',2,'lake-b']]);
  });
});
// Original feature contract: hydro-river-input.test.mjs
featureDescribe("hydro-river-input", () => {
  const assert = __suiteDependency6.default;
  const { copyFile,mkdtemp,mkdir,rm,writeFile } = __suiteDependency7;
  const { tmpdir } = __suiteDependency8;
  const { join } = __suiteDependency9;
  const test = __suiteDependency10.default;
  const { prepareHydroRiverSources } = __suiteDependency11;
test('river source discovery fingerprints requested original members and rejects duplicates',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-input-'));t.after(()=>rm(root,{recursive:true}));
  const source=join(root,'source');await mkdir(source);
  for(const ext of ['shp','shx','dbf'])await copyFile(`tests/fixtures/hydro-selection-oracle.${ext}`,join(source,`HydroRIVERS_v10_eu.${ext}`));
  await writeFile(join(source,'HydroRIVERS_v10_eu.prj'),'test projection');
  const result=await prepareHydroRiverSources({riverRoots:[root],codes:['eu']});
  assert.equal(result.length,1);assert.equal(result[0].specification.datasetCode,'eu');
  assert.deepEqual(result[0].sourceFiles.map(row=>row.file),['HydroRIVERS_v10_eu.shp','HydroRIVERS_v10_eu.shx',
    'HydroRIVERS_v10_eu.dbf','HydroRIVERS_v10_eu.prj']);
  assert.ok(result[0].sourceFiles.every(row=>/^[a-f0-9]{64}$/.test(row.sha256)));
  const duplicate=join(root,'duplicate');await mkdir(duplicate);
  await copyFile(join(source,'HydroRIVERS_v10_eu.shp'),join(duplicate,'HydroRIVERS_v10_eu.shp'));
  await assert.rejects(prepareHydroRiverSources({riverRoots:[root],codes:['eu']}),/exactly one/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(prepareHydroRiverSources({riverRoots:[root],codes:['eu'],signal:controller.signal}),{name:'AbortError'});
});
});
// Original feature contract: hydro-physical-replacement.test.mjs
featureDescribe("hydro-physical-replacement", () => {
  const test = __suiteDependency12.default;
  const assert = __suiteDependency13.default;
  const { createPhysicalWaterPresentation } = __suiteDependency14;
  const { createGeometryVersionStore } = __suiteDependency15;
const box=(x,y,size)=>({type:'Polygon',coordinates:[[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]]});
test('physical water follows the effective copied object geometry, reuses its mask and honors visibility',()=>{
 const source=box(2,2,2),land={type:'MultiPolygon',coordinates:[[box(0,0,10).coordinates[0],source.coordinates[0]]]};
 const owner=createPhysicalWaterPresentation();
 const context={geometry:land,revision:'land',water:source,waterRevision:'source',waterObjectRef:{domain:'hydroBuiltin',id:'sea'}};
 assert.equal(owner(context,null,true),context);
 assert.equal(owner(context,null,false).water,null);
 const store=createGeometryVersionStore([{id:'copy',version:1,geojson:box(3,2,2)}]);
 const copy={id:'copy',geometry:store.get({id:'copy',version:1})};
 const next=owner(context,copy,true);assert.equal(next.water,null,'the normal edited-water renderer owns the only copied fill');
 assert.equal(next,owner(context,{...copy},true));
 assert.deepEqual(globalThis.polygonClipping.xor(next.geometry.coordinates,globalThis.polygonClipping.difference([box(0,0,10).coordinates],copy.geometry.coordinates)),[]);
 assert.notEqual(next.revision,context.revision);
});
});
