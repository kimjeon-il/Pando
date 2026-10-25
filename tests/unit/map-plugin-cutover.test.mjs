import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectDomain } from "../../shared/frontend/js/modules/project-domain.js";
import { readAtlasTables } from "../../shared/frontend/js/workers/gpkg-read-core.js";
import { productionSql } from '../helpers/production-geopackage.mjs';

test('retired project attachments are rejected before Core validation or replacement', async () => {
  let calls=0;
  const domain=createProjectDomain({productMode:'editor',commandOwner:{validateImport:async()=>{calls++;return {};},inspectImport:async()=>{calls++;throw new Error('Unexpected Core invocation');}}});
  for(const packageAssets of [{schemaVersion:1},null,undefined]) {
    await assert.rejects(domain.prepareImport({packageAssets}),/retired|unsupported.*attachment/i);
    await assert.rejects(domain.inspectImport({packageAssets}),/retired|unsupported.*attachment/i);
  }
  assert.equal(calls,0);
  assert.deepEqual(await domain.prepareImport({current:true}),{});
  assert.equal(calls,1);
});

test('GeoPackage reader refuses retired image tables or settings even when empty', async () => {
  for(const sql of [
    'CREATE TABLE pandolab_reference_sources (source_hash TEXT)',
    "CREATE TABLE pandolab_project_settings (setting_key TEXT,json_value TEXT); INSERT INTO pandolab_project_settings VALUES ('reference_images','{}')",
    "CREATE TABLE pandolab_project_settings (setting_key TEXT,json_value TEXT); INSERT INTO pandolab_project_settings VALUES ('project_state','{\"packageAssets\":null}')",
  ]) {
    const db=new productionSql.Database();
    try {
      db.run(sql);
      await assert.rejects(readAtlasTables(db.export(),async()=>productionSql),/retired|unsupported.*attachment/i);
    } finally {db.close();}
  }
});
