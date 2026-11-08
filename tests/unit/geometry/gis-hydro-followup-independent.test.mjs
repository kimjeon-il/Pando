import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateIndependentHydronyms,verifyNaturalEarthEvidence}
  from "../../../tools/gis/hydro-independent-name-policy.mjs";
import {ORIGINAL_OSM_SYSTEM_IDS}
  from "../../../tools/gis/audit-osm-credit-removal.mjs";

const read=path=>JSON.parse(readFileSync(new URL("../../../"+path,import.meta.url),'utf8'));
const followup=read('tools/gis/hydro-followup-independent-name-replacements.json');
const inventory=read('tools/gis/osm-independent-river-source-inventory.json');
const earlier=read('tools/gis/hydro-independent-name-replacements.json');
test('two of the original 31 are approved from independent traces and government references',()=>{
  const verified=validateIndependentHydronyms(followup);
  assert.deepEqual(Object.keys(verified),['20773860','40423228']);
  const row=verified['20773860'];
  assert.equal(row.previousNameKo,'수에즈운하강');
  assert.equal(row.nameKo,'수에즈운하');
  assert.equal(row.naturalEarth.name,'Suez Canal');
  assert.equal(row.naturalEarth.sampleCoverage,.852);
  assert.equal(row.hydroRiversRegion,'eu');
  assert(ORIGINAL_OSM_SYSTEM_IDS.includes(row.systemId));
  assert(!earlier.replacements.some(x=>x.systemId===row.systemId));
  assert(!Object.values(verified).some(x=>x.systemId==='20774342'));
  for(const id of Object.keys(verified))assert(!earlier.replacements.some(x=>x.systemId===id));
  const branch=verified['40423228'];
  assert.equal(branch.previousNameKo,'남한강');
  assert.equal(branch.nameKo,'남한강');
  assert.equal(branch.naturalEarth.name,'Namhan');
  assert.equal(branch.naturalEarth.sampleCoverage,.802);
  assert.equal(branch.officialNationalAtlasBranchReview.downstreamNamedRiver,'Han');
  assert.equal(branch.officialNationalAtlasBranchReview.downstreamNameSampleCoverage,.37);
});
test('Suez 69/81 and Namhan 65/81 independent Natural Earth trace match the pinned audit',()=>{
  const trace=inventory.rows.find(x=>x.systemId==='20773860');
  const competing=inventory.rows.find(x=>x.systemId==='20774342');
  assert(trace&&competing);
  assert.equal(trace.currentNameKo,'수에즈운하강');
  assert.equal(trace.naturalEarthGeometryScreen.candidates[0].supportingSamples,69);
  assert.equal(competing.naturalEarthGeometryScreen.candidates[0]?.supportingSamples,4);
  const south=inventory.rows.find(x=>x.systemId==='40423228');
  assert.equal(south.naturalEarthGeometryScreen.candidates[0].name,'Namhan');
  assert.equal(south.naturalEarthGeometryScreen.candidates[0].supportingSamples,65);
  assert.equal(south.naturalEarthGeometryScreen.candidates[1].name,'Han');
  assert.equal(south.naturalEarthGeometryScreen.candidates[1].supportingSamples,30);
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
  const south=followup.replacements[1];
  assert(south.independentSources.some(ref=>ref.kind==='national-atlas-government'
    &&ref.url==='https://nationalatlas.ngii.go.kr/pages/page_4065.php'));
  assert.equal(south.officialNationalAtlasBranchReview.status,'geographic-branch-name-not-statutory-river-name');
});
