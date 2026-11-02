import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BAIKONUR_2019_EXCLUSIONS,BAIKONUR_2019_EFFECTIVE,
  parseOfficialFractionalDms,baikonur2019Exclusions,
} from '../../tools/gis/baikonur-2019-exclusions.mjs';
test('official 2019 exclusion polygons preserve 4/21/9/7 points',()=>{
  assert.deepEqual(Object.fromEntries(Object.entries(BAIKONUR_2019_EXCLUSIONS)
    .map(([id,rows])=>[id,rows.length])),{'1-1':4,'1-2':21,'1-3':9,'1-4':7});
  const collection=baikonur2019Exclusions();
  assert.equal(collection.properties.openStreetMapDataUsed,false);
  assert.equal(collection.features.length,4);
  assert.equal(collection.properties.unresolvedPlots.length,0);
  assert.equal(collection.properties.correctedOfficialTextDiscrepancy.plot,'1-3');
  assert.equal(collection.properties.correctedOfficialTextDiscrepancy.point,5);
  assert.equal(collection.properties.correctedOfficialTextDiscrepancy.verifiedLatitudeDms,'45 33 06,84');
  assert.equal(collection.properties.independentOfficialCrosschecks.length,2);
  const corrected=collection.features.find(x=>x.properties.plot==='1-3');
  assert(corrected);
  assert.deepEqual(corrected.geometry.coordinates[0][4], [63.299825,45.5519]);
  assert.equal(collection.properties.status,'RESEARCH_ONLY_NOT_FOR_RUNTIME');
});
test('fractional second DMS is parsed but malformed government text is not guessed',()=>{
  assert.equal(parseOfficialFractionalDms('45 44 14,16'),45.737266667);
  assert.equal(parseOfficialFractionalDms('63 01 05,00'),63.018055556);
  for(const invalid of ['45,33 06,84','45 60 00','45 01 61','-45 04 12'])
    assert.throws(()=>parseOfficialFractionalDms(invalid),/Malformed treaty DMS|out of bounds/);
});
test('closed polygons keep per-object provenance and effective dates',()=>{
  const collection=baikonur2019Exclusions();
  assert.equal(BAIKONUR_2019_EFFECTIVE,'2020-01-22');
  assert.equal(collection.properties.effectiveDate,BAIKONUR_2019_EFFECTIVE);
  for(const feature of collection.features){
    const ring=feature.geometry.coordinates[0];
    assert.deepEqual(ring.at(0),ring.at(-1));
    assert.equal(ring.length,BAIKONUR_2019_EXCLUSIONS[feature.properties.plot].length+1);
    assert.match(feature.properties.sourceUrl,/adilet\.zan\.kz/);
    assert.equal(feature.properties.geometryStatus,'research-only-unvalidated-topology');
  }
});
