import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {selectDiagnosticTile} from '../../tools/reference-analysis/diagnostic-selection.mjs';

test('diagnostic selection uses known positives and keeps the first maximum',async()=>{
  const annotation={width:1024,height:512,known:{coast:[[[90,190],[140,190],[140,210],[90,210]],[[690,190],[740,190],[740,210],[690,210]]],text:[[[100,100],[120,100],[120,110],[100,110]]]},
    lines:[{kind:'coast',points:[[100,200],[130,200]],width:3},{kind:'coast',points:[[700,200],[730,200]],width:3}],
    regions:[{kind:'text',polygon:[[100,100],[120,100],[120,110],[100,110]]}],ignore:[[[89,189],[141,189],[141,211],[89,211]]]};
  const selected=await selectDiagnosticTile({annotation});
  assert.deepEqual({index:selected.index,x:selected.x,y:selected.y,channel:selected.channel},{index:1,x:448,y:0,channel:2});
  assert.ok(selected.positivePixels>0);
});

test('large raster selection uses original known/target pixels and overlapping tile order',async()=>{
  const root='tests/fixtures',path='reference-training-raster/large-valid.png',bytes=await readFile(`${root}/${path}`);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const annotation={origin:'macro-vector-supervision',width:4097,height:4097,raster:{path,sha256},validRaster:{path,sha256}};
  const selected=await selectDiagnosticTile({root,annotation});
  assert.deepEqual(selected,{index:0,x:3584,y:3584,channel:0,positivePixels:9216});
  const invalid=structuredClone(annotation);invalid.raster.sha256='0'.repeat(64);
  await assert.rejects(selectDiagnosticTile({root,annotation:invalid}),/hash/i);
});
