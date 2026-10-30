import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {selectDiagnosticTile} from '../../tools/reference-analysis/diagnostic-selection.mjs';
import {reviewMasks} from '../../tools/reference-analysis/review-masks.mjs';

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

test('fractional review geometry is selected using full-sheet raster coordinates',async()=>{
  const annotation={width:1024,height:512,known:{coast:[[[570.5,20.2],[700.6,20.2],[700.6,400.8],[570.5,400.8]]]},
    lines:[{kind:'coast',points:[[0.5,30.8],[900.6,400.3]],width:3}],regions:[],ignore:[]};
  assert.deepEqual(await selectDiagnosticTile({annotation}),{index:0,x:448,y:0,channel:2,positivePixels:315});
});

test('full-sheet diagnostic masks match frozen Pillow pixels across tile boundaries',async()=>{
  const annotation={width:1024,height:512,known:{coast:[[[0.5,20.2],[700.6,20.2],[700.6,400.8],[0.5,400.8]]]},
    lines:[{kind:'coast',points:[[0.5,30.8],[900.6,400.3]],width:3}],regions:[],ignore:[]};
  const expected=[
    ['10e0e2bac1ce9371686fe1bfa9c091cbdeedea1d4fc8973f87e9bd3f1f20faf6','991e39e1ecf86e6f655bc280a552c819f19903f298723c7064e6da5f39d427a4'],
    ['87c89c61ff6c7d36469f3a6b9e93b7e1eb3d80817e156c21644a73b88708d14c','00c825bb10111b30613b121b0b7e3ee2abda0e5a65fa2aaf6dd05167a7b238fa'],
    ['c263251931a9f0227f8dc54c2aab0d42527490d03830b1d9dbcc25e352f4966d','8a39d2abd3999ab73c34db2476849cddf303ce389b35826850f9a700589b4a90'],
  ];
  for(const [i,x] of [0,448,896].entries()){
    const masks=await reviewMasks(annotation,{window:[x,0,512,512],fullSheetCoordinates:true});
    assert.deepEqual([masks.targetBits,masks.knownBits].map(value=>createHash('sha256').update(value).digest('hex')),expected[i]);
  }
});
