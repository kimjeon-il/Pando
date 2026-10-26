import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {resolve} from 'node:path';

const path=resolve('tests/fixtures/gis-caspian-1922-python-native-oracle.json');
const oracle=JSON.parse(readFileSync(path,'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const artifact=resolve('build-native/historical/caspian-1922-native-candidate.json');
const input=resolve('build-native/historical/approved-caspian-1922.zip');
const current=JSON.parse(readFileSync(artifact,'utf8'));
test('native approved 1922 display is byte-identical to the Shapely-proven Ubuntu reference',()=>{
  assert.equal(oracle.schema,'pando-approved-caspian-python-native-oracle-v1');
  assert.match(oracle.pythonReferenceRun,/actions\/runs\/40278421864$/);
  assert.equal(hash(readFileSync(input)),oracle.sourceArchiveSha256);
  assert.equal(hash(readFileSync(artifact)),oracle.verifiedNativeCandidateSha256,
    'Caspian display differs from the prior full Python-vs-C++ reference');
});
test('all real historical vertex, topology, area and simplification limits remain stable',()=>{
  const {network,water,metrics}=current,expected=oracle.constraints;
  assert.equal(network.features.length,expected.sourceFeatureCount);
  assert.equal(water.type,'MultiPolygon');
  assert.equal(water.coordinates.length,oracle.comparison.nativeWaterPolygons);
  assert.equal(water.coordinates[0].length-1,expected.holesAfter);
  for(const [name,value] of Object.entries(expected)){
    const actual=name==='sourceFeatureCount'?network.features.length:metrics[name];
    assert.equal(typeof actual,'number',name);
    const tolerance=name.endsWith('Km2')||name.endsWith('Meters')?1e-7:0;
    assert.ok(Math.abs(actual-value)<=tolerance,
      'Frozen historical Caspian metric changed: '+name+' '+actual+' vs '+value);
  }
  assert.equal(metrics.perFeatureToleranceMeters.length,266);
});
test('oracle proves shape parity only and does not approve current or past sovereignty',()=>{
  assert.equal(oracle.comparison.maximumCoordinateDifferenceDegrees,0);
  assert.equal(oracle.comparison.symmetricDifferenceKm2,0);
  assert.equal(oracle.comparison.unequalFeatureVertexCounts,0);
  assert.equal(oracle.comparison.unequalFeatureTolerances,0);
  assert.match(oracle.interpretation,/not a sovereignty/);
});
