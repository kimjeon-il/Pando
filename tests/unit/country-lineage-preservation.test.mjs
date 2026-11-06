import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import test from 'node:test';
import {entityFileName,readTerritorialLineages,readTerritorialSources,territorialSourceRoot} from '../../tools/territorial-entity-sources.mjs';

const baseline=JSON.parse(fs.readFileSync(new URL('../fixtures/country-lineage-pinned-sources.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const jsonSha=value=>sha(JSON.stringify(value));
function verifiedSource(path,expected){
 const bytes=fs.readFileSync(path);
 assert.equal(bytes.length,expected.bytes,`Pinned source byte length changed: ${path}`);
 assert.equal(sha(bytes),expected.sha256,`Pinned source contents changed: ${path}`);
 return JSON.parse(bytes);
}

test('current pinned catalog preserves all 286 identities, 265 lineages and 313 complete geometry versions',()=>{
 const config=JSON.parse(fs.readFileSync(new URL('../../config/library-data.json',import.meta.url),'utf8'));
 assert.equal(config.repository,baseline.provenance.repository);
 const review=baseline.provenance.runtimePinReview;
 assert.equal(review.previousReviewedRevision,baseline.provenance.acceptedKoreanBaselineRollback.runtime,
   'the source review must preserve the previously accepted revision');
 assert.equal(review.reviewedRuntimeRevision,config.revision,
   'the source review must match the active pinned revision');
 assert.equal(review.matchedSourceReceipts,baseline.counts.entities+baseline.counts.lineages,
   'the review must cover the complete country and lineage corpus');
 assert.equal(review.changedSourceReceipts,0,'a changed source requires its own review');
 // The reviewed runtime pin retains every original oracle receipt; the older
 // revision and archive index remain the independent source of those receipts.
 assert.equal(config.revision,baseline.provenance.reviewedRuntimeRevision,'the source oracle must be reviewed with a new data pin');
 // readTerritorialSources validates every source and the complete lineage/parent graph.
 const entities=readTerritorialSources(),lineages=readTerritorialLineages();
 assert.equal(entities.length,baseline.counts.entities);
 assert.equal(lineages.length,baseline.counts.lineages);
 assert.equal(entities.reduce((n,e)=>n+e.geometryVersions.length,0),baseline.counts.geometryVersions);
 assert.deepEqual(entities.map(e=>e.entityId).sort(),Object.keys(baseline.countries).sort());
 assert.deepEqual(lineages.map(lineage=>lineage.lineageId).sort(),Object.keys(baseline.lineages).sort());
 for(const lineage of lineages){
  const raw=verifiedSource(join(territorialSourceRoot,'lineages',`${lineage.lineageId}.json`),baseline.lineages[lineage.lineageId]);
  assert.deepEqual(lineage.entityRefs,raw.entityRefs);
  assert.deepEqual(lineage.relations,raw.relations);
 }
 for(const entity of entities){
  const raw=verifiedSource(join(territorialSourceRoot,'countries',entityFileName(entity.entityId)),baseline.countries[entity.entityId]);
  for(const field of ['entityId','entityKind','lineageId','names','alternateNames','lifetime','parentEntityId']){
   assert.deepEqual(entity[field],raw[field],`${entity.entityId}: ${field}`);
  }
  assert.equal(jsonSha(entity.sourceInfo),jsonSha(raw.sourceInfo||{}),`${entity.entityId}: source metadata`);
  assert.equal(entity.geometryVersions.length,raw.geometryVersions.length,entity.entityId);
  for(const [index,version] of entity.geometryVersions.entries()){
   const original=raw.geometryVersions[index];
   const {geometry,...metadata}=version,{geometry:originalGeometry,...originalMetadata}=original;
   assert.deepEqual(metadata,originalMetadata,`${entity.entityId}: geometry version metadata ${index}`);
   // Hash the entire geometry, including every ring and coordinate. The expected
   // source is independently certified above by the immutable archive index.
   assert.equal(jsonSha(geometry),jsonSha(originalGeometry),`${entity.entityId}: complete coordinates for ${version.versionId}`);
  }
 }
});
