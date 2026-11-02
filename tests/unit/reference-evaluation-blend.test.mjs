import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {assembleEvaluationPrediction,blendEvaluationWindow} from '../../tools/reference-analysis/native-evaluation.mjs';

test('evaluation overlap uses the original float32 tile weights and threshold',async()=>{
  const oracle=JSON.parse(readFileSync('tests/fixtures/reference-evaluation-blend.json','utf8'));
  const [width,height]=oracle.sheet,[x,y,windowWidth,windowHeight]=oracle.window,n=512*512;
  const tiles=oracle.tiles.map(([tileX,tileY],tileIndex)=>{
    const probabilities=Buffer.allocUnsafe(3*n*4);
    for(let channel=0;channel<3;channel++)for(let i=0;i<n;i++){
      const value=i%19===0?.55:((tileIndex*19+channel*23+(i*7)%101)%101)/100;
      probabilities.writeFloatLE(value,(channel*n+i)*4);
    }
    return {x:tileX,y:tileY,probabilities};
  });
  const window={x,y,width:windowWidth,height:windowHeight};
  const result=await blendEvaluationWindow({width,height,window,tiles});
  assert.equal(createHash('sha256').update(result).digest('hex'),oracle.sha256);
  for(const windowSize of [384,512]){
    let calls=0;const complete=await assembleEvaluationPrediction({width,height,windowSize,maxCachedTiles:4,predictTile:async origin=>{
      calls++;const tile=tiles.find(item=>item.x===origin.x&&item.y===origin.y);assert.ok(tile);return tile.probabilities;}});
    assert.equal(createHash('sha256').update(complete).digest('hex'),oracle.fullSha256);assert.equal(calls,4);
  }
  await assert.rejects(blendEvaluationWindow({width,height,window,tiles:[tiles[3],tiles[0]]}),/order/i);
  await assert.rejects(blendEvaluationWindow({width,height,window:{x:600,y:500,width:20,height:20},tiles:[tiles[0]]}),/tile/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(blendEvaluationWindow({width,height,window,tiles},{signal:controller.signal}),/abort/i);
});
