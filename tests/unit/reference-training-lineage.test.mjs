import assert from 'node:assert/strict';
import test from 'node:test';
import {assertEvaluationIndependence,buildTrainingLineage,validateTrainingLineage} from '../../tools/reference-analysis/training-lineage.mjs';

function sheet(id,split='train') {return {id,familyId:'family-'+id,editionId:'edition-'+id,duplicateGroup:'group-'+id,
  sha256:({train:'a',fresh:'b',selection:'d',test:'e',different:'f'}[id]??'0').repeat(64),split};}
test('lineage retains ancestors and records validation selection without including tests',()=>{
  const original=sheet('train'),parent=buildTrainingLineage([original]);
  const fresh=sheet('fresh'),selection=sheet('selection','validation'),ignored=sheet('test','test');
  const result=buildTrainingLineage([fresh,selection,ignored],{parent,parentSha256:'c'.repeat(64)});
  assert.deepEqual(result.parents,['c'.repeat(64)]);assert.equal(result.sheets.length,3);assert.equal(result.sheets[2].usage,'selection');
  assert.doesNotThrow(()=>assertEvaluationIndependence(result,[sheet('test','test')]));
  const leaked={...sheet('different','test'),familyId:original.familyId};assert.throws(()=>assertEvaluationIndependence(result,[leaked]),/familyId/);
  assert.throws(()=>assertEvaluationIndependence(result,[selection]),/independent/i);
});
test('incomplete ancestry, hash aliases, missing IDs and wrong split are rejected',()=>{
  assert.throws(()=>buildTrainingLineage([],{parent:{complete:false},parentSha256:'c'.repeat(64)}),/complete/i);
  assert.throws(()=>validateTrainingLineage({schemaVersion:1,complete:true,parents:['bad'],sheets:[]}),/complete/i);
  assert.throws(()=>buildTrainingLineage([sheet('train')],{parent:buildTrainingLineage([]),parentSha256:'bad'}),/complete/i);
  const lineage=buildTrainingLineage([sheet('train')]);
  assert.throws(()=>assertEvaluationIndependence(lineage,[{...sheet('different','test'),sha256:'a'.repeat(64)}]),/sha256/);
  assert.throws(()=>assertEvaluationIndependence(lineage,[{...sheet('different','test'),editionId:null}]),/editionId/);
  assert.throws(()=>assertEvaluationIndependence(buildTrainingLineage([]),[{...sheet('different','test'),familyId:null}]),/familyId/);
  assert.throws(()=>assertEvaluationIndependence(lineage,[sheet('different','validation')]),/split/i);
});
