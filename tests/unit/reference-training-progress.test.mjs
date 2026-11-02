import assert from 'node:assert/strict';
import test from 'node:test';
import {accumulateEpochLoss,assertReplayedEpochProgress,decideTrainingEpoch} from '../../tools/reference-analysis/training-progress.mjs';

test('batch loss survives resume and does not invent missing prior history',()=>{
  const first=accumulateEpochLoss(null,0,2),second=accumulateEpochLoss({epoch:0,...first},0,1);
  assert.deepEqual(second,{epochLossSum:3,epochLossCount:2});
  assert.deepEqual(accumulateEpochLoss({epoch:0},0,1),{epochLossSum:null,epochLossCount:null});
  assert.deepEqual(accumulateEpochLoss({epoch:0},1,4),{epochLossSum:4,epochLossCount:1});
  assert.throws(()=>accumulateEpochLoss(null,0,NaN),/loss/i);
});
test('best selection uses validation loss and only validation enables early stopping',()=>{
  const receipt={epoch:1,cursor:2,orderLength:2,epochLossSum:3,epochLossCount:2};
  assert.deepEqual(decideTrainingEpoch(receipt,{validationLoss:0,bestScore:.5,stale:1,patience:2}),
    {trainingLoss:1.5,validationLoss:0,score:0,improved:true,bestScore:0,stale:0,stop:false});
  assert.equal(decideTrainingEpoch(receipt,{validationLoss:.6,bestScore:.5,stale:1,patience:2}).stop,true);
  assert.equal(decideTrainingEpoch(receipt,{validationLoss:null,bestScore:1,stale:1,patience:2}).stop,false);
  assert.throws(()=>decideTrainingEpoch({...receipt,cursor:1},{validationLoss:null,patience:2}),/complete/i);
});
test('optimizer replay rejects changed or missing epoch loss used for model selection',()=>{
  const receipt={epoch:1,epochLossSum:3.25,epochLossCount:2};
  assert.doesNotThrow(()=>assertReplayedEpochProgress(receipt,{...receipt}));
  for(const replayed of [{...receipt,epochLossSum:3.5},{...receipt,epochLossCount:3},
    {...receipt,epoch:2},{...receipt,epochLossSum:null},{...receipt,epochLossCount:0}])
    assert.throws(()=>assertReplayedEpochProgress(receipt,replayed),/epoch.*loss/i);
  assert.throws(()=>assertReplayedEpochProgress({...receipt,epochLossSum:null},receipt),/epoch.*loss/i);
});
