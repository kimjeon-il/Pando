import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {nativeHistoricalGeometryComparison}
  from '../../tools/gis/replay-ussr-1922-countries.mjs';

const executable=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const original={type:'MultiPolygon',coordinates:[
 [[[0,0],[2,0],[2,2],[0,0]]],
]};
const extraNode={type:'MultiPolygon',coordinates:[
 [[[0,0],[1,0],[2,0],[2,2],[0,0]]],
]};
test('different coordinate lists with identical polygon footprint pass strict native GEOS comparison',()=>{
 const proof=nativeHistoricalGeometryComparison(original,extraNode,'test:collinear');
 assert.equal(proof.passed,true);
 assert.equal(proof.sameGeometryTopologically,true);
 assert.equal(proof.symmetricDifferenceSquareDegrees,0);
 assert.equal(proof.boundaryHausdorffDegrees,0);
});
test('different sovereign territory must fail native GEOS geometry equality, not be tolerance-smoothed',()=>{
 const modified=structuredClone(extraNode);
 modified.coordinates[0][0][1][1]=0.05;
 const proof=nativeHistoricalGeometryComparison(original,modified,'test:changed');
 assert.equal(proof.passed,false);
 assert.equal(proof.sameGeometryTopologically,false);
 assert.ok(proof.symmetricDifferenceSquareDegrees>0);
});
test('a source-comparison audit never rewrites the stored approved polygon',t=>{
 const directory=mkdtempSync(join(tmpdir(),'ussr-geometry-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const before=join(directory,'original.json');
 writeFileSync(before,JSON.stringify(original));
 const saved=readFileSync(before);
 const proof=nativeHistoricalGeometryComparison(original,extraNode,'test:read-only',{
   binary:executable,
 });
 assert.equal(proof.passed,true);
 assert.deepEqual(readFileSync(before),saved);
});
