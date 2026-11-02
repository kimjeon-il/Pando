import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateIndependentHydronyms,verifyNaturalEarthEvidence}
  from '../../tools/gis/hydro-independent-name-policy.mjs';
import {ORIGINAL_OSM_SYSTEM_IDS}
  from '../../tools/gis/audit-osm-credit-removal.mjs';

const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url),'utf8'));
const followup=read('tools/gis/hydro-followup-independent-name-replacements.json');
const inventory=read('tools/gis/osm-independent-river-source-inventory.json');
const earlier=read('tools/gis/hydro-independent-name-replacements.json');
test('only one of the original 31 is approved from independent geometry and an actual national authority',()=>{
  const verified=validateIndependentHydronyms(followup);
  assert.deepEqual(Object.keys(verified),['20773860']);
  const row=verified['20773860'];
  assert.equal(row.previousNameKo,'수에즈운하강');
  assert.equal(row.nameKo,'수에즈운하');
  assert.equal(row.naturalEarth.name,'Suez Canal');
  assert.equal(row.naturalEarth.sampleCoverage,.852);
  assert.equal(row.hydroRiversRegion,'af');
  assert(ORIGINAL_OSM_SYSTEM_IDS.includes(row.systemId));
  assert(!earlier.replacements.some(x=>x.systemId===row.systemId));
  assert(!Object.values(verified).some(x=>x.systemId==='20774342'));
});
test('candidate 69/81 independent Natural Earth trace matches pinned work/gis audit',()=>{
  const trace=inventory.rows.find(x=>x.systemId==='20773860');
  const competing=inventory.rows.find(x=>x.systemId==='20774342');
  assert(trace&&competing);
  assert.equal(trace.currentNameKo,'수에즈운하강');
  assert.equal(trace.naturalEarthGeometryScreen.candidates[0].supportingSamples,69);
  assert.equal(competing.naturalEarthGeometryScreen.candidates[0]?.supportingSamples,4);
  assert.equal(inventory.pinnedBundleSha256,followup.reference.baselineBundleSha256);
  assert.equal(followup.reference.screenRunId,inventory.naturalEarthCrosscheckRunId);
  const candidates=inventory.rows.map(row=>({
    systemId:row.systemId,
    naturalEarthCandidates:row.naturalEarthGeometryScreen.candidates
  }));
  verifyNaturalEarthEvidence(followup,{items:candidates});
});
test('Suez Canal authority and Natural Earth are independent and do not grant OSM attribution',()=>{
  const row=followup.replacements[0];
  const sourceKinds=new Set(row.independentSources.map(x=>x.kind));
  assert(sourceKinds.has('government-hydrology'));
  assert(sourceKinds.has('public-domain-vector'));
  assert(row.independentSources.every(x=>!/(?:openstreetmap|overpass)/i.test(x.url)));
  assert.equal(followup.reference.geometryChanged,false);
  assert.match(row.reviewNotes,/Only this Hydro system/);
});
