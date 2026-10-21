import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as sources from '../../tools/territorial-entity-sources.mjs';

const sample=entityId=>({schemaVersion:2,entityId,entityKind:'general',names:{ko:entityId},lifetime:{validFrom:null,validTo:null},geometryVersions:[{versionId:'border',validFrom:null,validTo:null,geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[0,0]]]}}]});
function writeFixture(root) {
  fs.mkdirSync(path.join(root,'countries'));fs.mkdirSync(path.join(root,'lineages'));
  const lineage={schemaVersion:2,lineageId:'germany',names:{ko:'독일'},entityRefs:['state:DEU','state:GDR'],relations:[{type:'successor',from:'state:GDR',to:'state:DEU'}]};
  fs.writeFileSync(path.join(root,'lineages/germany.json'),JSON.stringify(lineage));
  for(const id of lineage.entityRefs)fs.writeFileSync(path.join(root,'countries',sources.entityFileName(id)),JSON.stringify({...sample(id),lineageId:'germany'}));
  return lineage;
}

test('independent country files retain scoped versions and reference-only lineage membership',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pando-lineage-'));t.after(()=>fs.rmSync(root,{recursive:true}));
  writeFixture(root);
  const result=sources.readTerritorialSources(root);
  assert.deepEqual(result.map(e=>[e.entityId,e.lineageId,e.geometryVersions[0].versionId]),[['state:DEU','germany','border'],['state:GDR','germany','border']]);
  assert.throws(()=>sources.entityFileName('state:../escape'),/Unsafe/);
});
test('source update changes only explicit identity and preserves curated sibling, names and relations',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pando-lineage-'));t.after(()=>fs.rmSync(root,{recursive:true}));
  const lineage=writeFixture(root);
  const sibling=fs.readFileSync(path.join(root,'countries/state-DEU.json'),'utf8');
  sources.updateTerritorialSource('state:GDR',entity=>({...entity,metadata:{note:'curated'}}),root);
  const result=JSON.parse(fs.readFileSync(path.join(root,'countries/state-GDR.json'),'utf8'));
  assert.equal(fs.readFileSync(path.join(root,'countries/state-DEU.json'),'utf8'),sibling);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'lineages/germany.json'),'utf8')),lineage);
  assert.equal(result.metadata.note,'curated');
  const before=fs.readFileSync(path.join(root,'countries/state-GDR.json'),'utf8');
  assert.throws(()=>sources.updateTerritorialSource('state:GDR',e=>({...e,entityId:'state:wrong'}),root));
  assert.equal(fs.readFileSync(path.join(root,'countries/state-GDR.json'),'utf8'),before);
});

test('orphan or multiply-owned country objects and dangling parent edits are rejected atomically',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pando-country-'));t.after(()=>fs.rmSync(root,{recursive:true}));
 writeFixture(root);const file=path.join(root,'countries/state-GDR.json');const before=fs.readFileSync(file,'utf8');
 assert.throws(()=>sources.updateTerritorialSource('state:GDR',e=>({...e,parentEntityId:'state:missing'}),root));
 assert.equal(fs.readFileSync(file,'utf8'),before);
 fs.writeFileSync(path.join(root,'countries/state-orphan.json'),JSON.stringify({...sample('state:orphan'),lineageId:'germany'}));
 assert.throws(()=>sources.readTerritorialSources(root));
});
