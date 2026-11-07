import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {resolve} from 'node:path';

// Original feature contract: gis-caspian-pinned-native-oracle.test.mjs
// The retired external-interpreter comparison is not reproduced. The approved
// source hashes, fixed Native output bytes and numerical constraints remain.
const baseline=JSON.parse(readFileSync(resolve('tests/fixtures/gis-caspian-1922-native-baseline.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const artifact=resolve('build-native/historical/caspian-1922-native-candidate.json');
const input=resolve('build-native/historical/approved-caspian-1922.zip');
const current=JSON.parse(readFileSync(artifact,'utf8'));
test('approved native 1922 display preserves pinned source and output bytes',()=>{
  assert.equal(baseline.schema,'pando-caspian-1922-approved-native-baseline-v1');
  assert.equal(hash(readFileSync(input)),baseline.sourceArchiveSha256);
  assert.equal(hash(readFileSync(artifact)),baseline.verifiedNativeCandidateSha256,
    'Native 1922 Caspian output changed from the approved immutable baseline');
});
test('historical native vertex, topology, area and simplification constraints remain stable',()=>{
  const {network,water,metrics}=current,expected=baseline.constraints;
  assert.equal(network.features.length,expected.sourceFeatureCount);
  assert.equal(water.type,'MultiPolygon');
  assert.equal(water.coordinates.length,baseline.expectedNativeWaterPolygons);
  assert.equal(water.coordinates[0].length-1,expected.holesAfter);
  for(const [name,value] of Object.entries(expected)){
    const actual=name==='sourceFeatureCount'?network.features.length:metrics[name];
    assert.equal(typeof actual,'number',name);
    const tolerance=name.endsWith('Km2')||name.endsWith('Meters')?1e-7:0;
    assert.ok(Math.abs(actual-value)<=tolerance,
      'Approved native historical metric changed: '+name+' '+actual+' vs '+value);
  }
  assert.equal(metrics.perFeatureToleranceMeters.length,expected.sourceFeatureCount);
});
test('approved source geometry evidence does not assert external calculation parity or sovereignty',()=>{
  assert.match(baseline.interpretation,/do not establish an independent/);
  assert.match(baseline.interpretation,/sovereignty/);
});
