import assert from 'node:assert/strict';
import test from 'node:test';
import {captureOriginalLinkedLabelRemoval} from '../helpers/web-removal-oracle.mjs';

test('original current Web deletion succeeds and stores the unchanged non-owning territorial label ID',async()=>{
  const {result,expected}=await captureOriginalLinkedLabelRemoval();
  assert.deepEqual(result,expected);
  assert.equal(result.applied,true);
  assert.equal(result.savedLabel.territorialUnitId,'A');
  assert.deepEqual(result.remainingIds,[]);
  assert.equal(result.stateRevision,1);
  assert.equal(result.undo,true);
});
