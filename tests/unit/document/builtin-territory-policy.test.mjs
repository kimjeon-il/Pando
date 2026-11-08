import assert from 'node:assert/strict';
import test from 'node:test';
import {mergeBuiltinTerritories} from '../../../src/document/builtin-territory-policy.js';

test('territory display merges preserve every disjoint polygon, attribution and original input',()=>{
  const square=x=>({type:'Polygon',coordinates:[[[x,0],[x,1],[x+1,1],[x+1,0],[x,0]]]});
  const feature=(id,x)=>({type:'Feature',id,properties:{name:id,metadata:{retained:true}},geometry:square(x)});
  const input={type:'FeatureCollection',features:[feature('AAA',0),feature('BBB',10),feature('CCC',20)]};
  const policy=[{sourceId:'BBB',controller:'AAA',note:'Synthetic display-only assignment'}];
  const before=structuredClone(input),result=mergeBuiltinTerritories(input,policy,{policyRevision:'fixture'});
  assert.deepEqual(result.features.map(row=>row.id),['AAA','CCC']);
  assert.deepEqual(result.features[0].geometry,{type:'MultiPolygon',coordinates:input.features.slice(0,2).map(row=>row.geometry.coordinates)});
  assert.deepEqual(result.features[0].properties.metadata,{retained:true,builtinTerritoryDisplay:{policyRevision:'fixture',mergedSources:policy}});
  assert.equal(result.features[1],input.features[2]);
  assert.deepEqual(input,before);
  assert.deepEqual(mergeBuiltinTerritories(result,policy,{policyRevision:'fixture'}),result);
  assert.throws(()=>mergeBuiltinTerritories(input),TypeError);
  assert.throws(()=>mergeBuiltinTerritories(input,[{sourceId:'BBB',controller:'missing'}]),/대상 누락/);
  policy[0].note='Changed by caller';
  assert.equal(result.features[0].properties.metadata.builtinTerritoryDisplay.mergedSources[0].note,'Synthetic display-only assignment');
});
