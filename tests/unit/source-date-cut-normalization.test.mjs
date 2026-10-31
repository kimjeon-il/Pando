import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readTerritorialSources,territorialSourceRoot} from '../../tools/territorial-entity-sources.mjs';
import {selectGeometryVersion} from '../../apps/editor/frontend/js/modules/territorial-library.js';
import {SOURCE_CUTS,SOURCE_REFERENCE_DATE,planSourceDateConsolidation} from '../../tools/gis/normalize-2026-source-reference.mjs';
import {selectBuiltinCountries,assembleBuiltinWorld} from '../../shared/frontend/js/modules/builtin-world-loader.js';
import {temporalContains,temporalMonthEnd} from '../../shared/frontend/js/modules/temporal.js';

const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const world=new URL('../../assets/data/builtin-world/generated/v1/',import.meta.url);
test('source reference 2026-10-06 never becomes a political geometry transition',()=>{
 const entries=readTerritorialSources(),byId=new Map(entries.map(e=>[e.entityId,e]));
 const view=JSON.parse(fs.readFileSync(territorialSourceRoot+'/views/world.json','utf8'));
 const outcome=planSourceDateConsolidation(entries,view);
 assert.equal(outcome.already,true,'Five verified sources must be normalized before publishing');
 assert.equal(outcome.proof.length,5);
 for(const rule of SOURCE_CUTS){
  const e=byId.get(rule.id),kept=e.geometryVersions.find(v=>v.versionId===rule.history);
  assert.ok(e);
  assert.equal(e.lifetime.validTo,null,rule.id);
  assert.equal(kept.validFrom,rule.first,rule.id+' event date');
  assert.equal(kept.validTo,null,rule.id+' must remain valid without a fabricated end date');
  assert.equal(kept.certainty,'low',rule.id+' historical proxy confidence');
  assert.equal(kept.historicalProvenance.sourceReferenceDate,SOURCE_REFERENCE_DATE);
  assert.equal(e.metadata.sourceOutlineReferenceDate,SOURCE_REFERENCE_DATE);
  assert.equal(e.metadata.representativeGeometryVersionId,rule.history);
  assert.equal(e.geometryVersions.some(v=>v.versionId===rule.modern),false);
  assert.equal(e.geometryVersions.some(v=>v.validFrom===SOURCE_REFERENCE_DATE||v.validTo==='2026-10-05'),false);
  assert.equal(e.sourceInfo.temporalBoundaryCorrection.kind,'source-reference-date-not-geopolitical-event');
  assert.equal(e.sourceInfo.temporalBoundaryCorrection.geometrySha256,sha(kept.geometry));
  assert.equal(selectGeometryVersion(e,'2026-10-05')?.versionId,rule.history);
  assert.equal(selectGeometryVersion(e,'2026-10-06')?.versionId,rule.history);
  assert.equal(selectGeometryVersion(e,'2026-10-31')?.versionId,rule.history);
  assert.equal(view.selections.find(row=>row.entityId===rule.id)?.geometryVersionId,rule.history);
 }
});
test('published world retains uninterrupted source geometry through October 2026',()=>{
 const index=JSON.parse(fs.readFileSync(new URL('index.json',world),'utf8'));
 const entries=new Map(index.entities.map(row=>[row.entityId,row]));
 const selected=new Set(selectBuiltinCountries(index,'2026-10').map(row=>row.entityId));
 const selectedPrevious=new Set(selectBuiltinCountries(index,'2026-09').map(row=>row.entityId));
 for(const rule of SOURCE_CUTS){
  const projectId=rule.id.slice('state:'.length);
  assert.ok(selected.has(projectId),projectId+' missing in October');
  assert.ok(selectedPrevious.has(projectId),projectId+' missing in September');
  const record=entries.get(projectId);
  assert.ok(record);
  const compressed=fs.readFileSync(new URL(record.file,world));
  assert.equal(createHash('sha256').update(compressed).digest('hex'),record.sha256);
  const compiled=JSON.parse(gunzipSync(compressed));
  const selectedSource=month=>compiled.sourceBindings.find(row=>temporalContains(row,temporalMonthEnd(month)))?.sourceVersionId;
  assert.equal(selectedSource('2026-09'),rule.history,projectId+' prior source');
  assert.equal(selectedSource('2026-10'),rule.history,projectId+' current source');
  const active=month=>assembleBuiltinWorld({...index,entities:[record]},[compiled],month);
  const before=active('2026-09'),after=active('2026-10');
  assert.equal(before.territorialEntities[0].properties.sourceGeometryVersion,rule.history);
  assert.equal(after.territorialEntities[0].properties.sourceGeometryVersion,rule.history);
 }
});
