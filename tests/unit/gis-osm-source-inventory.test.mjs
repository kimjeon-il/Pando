import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {ORIGINAL_OSM_SYSTEM_IDS} from '../../tools/gis/audit-osm-credit-removal.mjs';

const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url),'utf8'));
const file='tools/gis/osm-independent-river-source-inventory.json';
test('all 31 OSM linked Hydro systems have a non-promoted independent-source review record',()=>{
  const audit=read(file);
  assert.equal(audit.schema,'pando-osm-hydro-independent-source-candidate-inventory-v1');
  assert.equal(audit.osmWaterwayMatchedSystems,31);
  assert.equal(audit.approvedSystems,0);
  assert.equal(audit.rows.length,31);
  assert.deepEqual(new Set(audit.rows.map(x=>x.systemId)),new Set(ORIGINAL_OSM_SYSTEM_IDS));
  assert.equal(new Set(audit.rows.map(x=>x.systemId)).size,31);
  assert(audit.rows.every(x=>x.metadataReplacementApproved===false
    &&x.independentIdentityConfirmed===false&&x.geometryChanged===false));
  assert(audit.rows.every(x=>x.namedPointCandidateUrls.every(url=>/^https:\/\//.test(url)
    &&!/openstreetmap|overpass/i.test(url))));
});
test('all reviewed IDs and names are exactly matched against the existing published source investigations',()=>{
  const audit=read(file);
  const baselines=[
    'tests/fixtures/hydro-osm-batch01-v0132-expected.json',
    'tests/fixtures/hydro-osm-batch02-default-v0132-expected.json',
    'tests/fixtures/hydro-osm-batch03-v0132-expected.json',
  ];
  for(let n=0;n<3;n++){
    const fixture=read(baselines[n]);
    for(const item of fixture.items){
      const row=audit.rows.find(r=>r.systemId===item.systemId);
      assert(row);
      assert.equal(row.auditedBatch,n+1);
      assert.equal(row.priorEvidenceFile,baselines[n]);
      assert.equal(row.currentNameKo,item.publishedNameKo||item.originalNameKo);
      if(n===2)assert.equal(row.priorScreenIdentityConfirmed,false);
    }
  }
  assert.equal(audit.rows.filter(x=>!x.namedPointCandidateUrls.length).length,8);
});
