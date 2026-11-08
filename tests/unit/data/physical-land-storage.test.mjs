import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysicalLandPatch} from '../../../tools/data/physical-land-storage.mjs';
import {applyPhysicalLandPatch,loadPhysicalLandGeometry,regionalLandLayout} from '../../../src/data/physical-land-patch.js';
import {collectRuntimeDataAssets} from '../../../src/data/runtime-manifest-assets.js';

test('regional storage preserves exact polygon/ring order, reuses base coordinates, and rejects overlapping replacements',async()=>{
 const outer=[[0,0],[5,0],[5,5],[0,5],[0,0]],hole=[[1,1],[1,2],[2,1],[1,1]],other=[[10,0],[11,0],[11,1],[10,0]];
 const base={type:'MultiPolygon',coordinates:[[outer,hole],[other]]},original=JSON.stringify(base);
 const target={type:'MultiPolygon',coordinates:[[outer],[other.slice().reverse()],[hole]]};
 const patch=createPhysicalLandPatch(base,target,{validFrom:'1922-01-01',validTo:'1929-12-31'});
 const restored=applyPhysicalLandPatch(base,patch);
 assert.equal(JSON.stringify(restored),JSON.stringify(target));assert.equal(JSON.stringify(base),original);
 assert.equal(restored.coordinates[0][0],base.coordinates[0][0]);
 assert.equal(patch.ringReplacements.length,1);assert.ok(patch.replacements.length);
 assert.ok(patch.replacements.flatMap(r=>r.polygons.flatMap(p=>p.rings.flat())).some(segment=>segment.base?.step===-1));
 const invalid=structuredClone(patch);invalid.replacements.push(invalid.replacements[0]);assert.throws(()=>applyPhysicalLandPatch(base,invalid),/overlap|order/);
 assert.throws(()=>applyPhysicalLandPatch({...base,coordinates:[]},patch),/base/);
 const spec={storageLayout:regionalLandLayout,base:{url:'base'},replacement:{url:'patch'},contentSha256:patch.resultContentSha256};
 assert.equal(JSON.stringify(await loadPhysicalLandGeometry(spec,{loadGeometry:()=>base,loadPatch:()=>patch})),JSON.stringify(target));
 await assert.rejects(loadPhysicalLandGeometry(spec,{loadGeometry:()=>target,loadPatch:()=>patch}),/base|identity/);
 const manifestPath='assets/data/physical-land/v1/manifest.json',regional={...spec,url:'assets/data/old-full-land.gz',base:{url:'assets/data/base.gz'},replacement:{url:'assets/data/replacement.gz'}};
 const assets=collectRuntimeDataAssets({availablePaths:[manifestPath,regional.url,regional.base.url,regional.replacement.url],readManifest:()=>({asset:regional,waterObjects:{geometries:[]}})});
 assert.deepEqual([...assets].sort(),[manifestPath,regional.base.url,regional.replacement.url].sort(),'deployment selects only actual base/replacement transfers');
});
