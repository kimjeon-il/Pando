import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as sources from '../../tools/territorial-entity-sources.mjs';

const sample=entityId=>({schemaVersion:2,entityId,entityKind:'general',names:{ko:entityId},lifetime:{validFrom:null,validTo:null},geometryVersions:[{versionId:'border',validFrom:null,validTo:null,geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[0,0]]]}}]});
test('lineage file holds multiple identities and scoped version IDs without source duplication',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pando-lineage-'));t.after(()=>fs.rmSync(root,{recursive:true}));
  fs.mkdirSync(path.join(root,'countries'));
  fs.writeFileSync(path.join(root,'countries/germany.json'),JSON.stringify({schemaVersion:1,lineageId:'germany',names:{ko:'독일'},entities:[sample('state:DEU'),sample('state:GDR')],relations:[]}));
  const result=sources.readTerritorialSources(root);
  assert.deepEqual(result.map(e=>[e.entityId,e.lineageId,e.geometryVersions[0].versionId]),[['state:DEU','germany','border'],['state:GDR','germany','border']]);
  assert.throws(()=>sources.entityFileName('state:../escape'),/Unsafe/);
});
test('source update changes only explicit identity and preserves curated sibling, names and relations',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pando-lineage-'));t.after(()=>fs.rmSync(root,{recursive:true}));
  fs.mkdirSync(path.join(root,'countries'));
  const lineage={schemaVersion:1,lineageId:'germany',names:{ko:'독일'},entities:[sample('state:DEU'),sample('state:GDR')],relations:[{type:'successor',from:'state:GDR',to:'state:DEU'}]};
  fs.writeFileSync(path.join(root,'countries/germany.json'),JSON.stringify(lineage));
  sources.updateTerritorialSource('state:GDR',entity=>({...entity,metadata:{note:'curated'}}),root);
  const result=JSON.parse(fs.readFileSync(path.join(root,'countries/germany.json'),'utf8'));
  assert.deepEqual(result.entities[0],lineage.entities[0]);
  assert.deepEqual(result.names,lineage.names);assert.deepEqual(result.relations,lineage.relations);
  assert.equal(result.entities[1].metadata.note,'curated');
  const before=fs.readFileSync(path.join(root,'countries/germany.json'),'utf8');
  assert.throws(()=>sources.updateTerritorialSource('state:GDR',e=>({...e,entityId:'state:wrong'}),root));
  assert.equal(fs.readFileSync(path.join(root,'countries/germany.json'),'utf8'),before);
});
