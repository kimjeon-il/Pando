import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readTerritorialSources,readTerritorialLineages} from '../../tools/territorial-entity-sources.mjs';
import {planPost2000CountryLinks} from '../../tools/gis/apply-post-2000-territorial-links.mjs';

const hash=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
test('transition plan reuses existing geometry and does not predate independence',()=>{
 const sources=readTerritorialSources();
 const policy={schemaVersion:1,replacements:[]};
 const plan=planPost2000CountryLinks(sources,readTerritorialLineages(),policy);
 const byId=new Map(sources.map(x=>[x.entityId,x]));
 if(plan.already){
  assert.ok(byId.has('state:untaet-east-timor'));
  assert.ok(byId.has('state:unmik-kosovo'));
  return;
 }
 const yugoslavia=byId.get('state:yugoslavia');
 const newYugo=plan.updated[0];
 assert.equal(hash(newYugo.geometryVersions.at(-1).geometry),hash(yugoslavia.geometryVersions.at(-1).geometry));
 assert.equal(newYugo.geometryVersions.at(-1).validFrom,'2003-02-04');
 assert.equal(newYugo.lifetime.validTo,'2006-06-02');
 const timor=plan.created.find(x=>x.entityId==='state:untaet-east-timor');
 const kosovo=plan.created.find(x=>x.entityId==='state:unmik-kosovo');
 assert.equal(hash(timor.geometryVersions[0].geometry),hash(byId.get('state:TLS').geometryVersions[0].geometry));
 assert.equal(hash(kosovo.geometryVersions[0].geometry),hash(byId.get('state:KOS').geometryVersions[0].geometry));
 assert.deepEqual(timor.lifetime,{validFrom:'1999-10-25',validTo:'2002-05-19'});
 assert.deepEqual(kosovo.lifetime,{validFrom:'1999-06-10',validTo:'2008-02-16'});
 assert.equal(byId.get('state:TLS').lifetime.validFrom,'2002-05-20');
 assert.equal(byId.get('state:KOS').lifetime.validFrom,'2008-02-17');
 assert.equal(byId.get('state:SDN').geometryVersions[0].validTo,'2011-07-08');
 assert.equal(byId.get('state:SDS').geometryVersions[0].validFrom,'2011-07-09');
});
