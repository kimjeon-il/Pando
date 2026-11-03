import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBaikonurBankCandidate} from '../../tools/gis/validate-baikonur-independent-banks.mjs';
test('missing candidate is rejected',()=>{
  assert.throws(()=>validateBaikonurBankCandidate(null),/FeatureCollection/);
});
test('unverified coordinate datum is rejected',()=>{
  assert.throws(()=>validateBaikonurBankCandidate({type:'FeatureCollection',features:[],properties:{openStreetMapDataUsed:false}}),/datum/);
});
