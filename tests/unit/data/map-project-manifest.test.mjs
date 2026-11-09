import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateMapProjectManifest,mapProjectResourcePaths,mapProjectResourcePath,MAP_PROJECT_ROLES}
  from '../../../src/data/map-project-manifest.js';
const current=JSON.parse(readFileSync(new URL('../../../projects/default-world/manifest.json',import.meta.url),'utf8'));

test('default world declares content catalogs while viewer owns resource types',()=>{
 const p=validateMapProjectManifest(current);
 assert.equal(p.projectId,'default-world');
 assert.equal(p.documentFormat,'pandolab-project-state');
 assert.equal(MAP_PROJECT_ROLES.length,Object.keys(p.resources).length);
 assert.equal(mapProjectResourcePath(p,'territorial'),'assets/data/builtin-world/generated/v1/index.json');
 assert.equal(p.resources.rivers.catalog,p.resources.lakes.catalog);
 assert.equal(mapProjectResourcePaths(p).length,8,'shared hydro catalog is not duplicated');
 assert.equal(Object.isFrozen(p.resources),true);
 assert.equal(Object.isFrozen(p.resources.territorial),true);
});
test('project content manifests fail closed on unknown roles, missing content and unsafe URLs',()=>{
 assert.throws(()=>validateMapProjectManifest({...current,projectId:'../other'}),/identity/);
 assert.throws(()=>validateMapProjectManifest({...current,resources:{...current.resources,
    unexpected:{catalog:'assets/data/a.json'}}}),/resource role/);
 const {[MAP_PROJECT_ROLES[0]]:unused,...missing}=current.resources;
 assert.throws(()=>validateMapProjectManifest({...current,resources:missing}),/resource role/);
 for(const candidate of ['../secret.json','assets/data/../secret.json',
      'assets/data/maps.json?rev=1','https://example.invalid/world.json']){
   assert.throws(()=>validateMapProjectManifest({...current,resources:{...current.resources,
      places:{catalog:candidate}}}),/resource path/);
 }
 assert.throws(()=>mapProjectResourcePath(current,'invented'),/Unknown map/);
});
test('changing one project collection changes only its declared resource graph',()=>{
 const other=validateMapProjectManifest({...current,projectId:'alternate-world',resources:{
   ...current.resources,territorial:{catalog:'assets/data/alternate/territories.json'}}});
 assert.equal(mapProjectResourcePath(other,'territorial'),'assets/data/alternate/territories.json');
 assert.equal(mapProjectResourcePath(other,'rivers'),mapProjectResourcePath(current,'rivers'));
 assert.equal(mapProjectResourcePath(current,'territorial'),'assets/data/builtin-world/generated/v1/index.json');
});
