import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateMapProjectManifest,mapProjectResourcePaths,mapProjectResourcePath,mapProjectManifestSourcePath,MAP_PROJECT_ROLES,mapProjectDocumentIdentity,mapProjectResourceScope}
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

test('project source path is determined by validated project identity only',()=>{
 assert.equal(mapProjectManifestSourcePath('default-world'),'projects/default-world/manifest.json');
 assert.equal(mapProjectManifestSourcePath('alternate-world'),'projects/alternate-world/manifest.json');
 for(const id of ['', '../other','default/../world','UPPER','local?rev=1'])
  assert.throws(()=>mapProjectManifestSourcePath(id),/project ID/);
});

test('default world binds its stable project ID to runtime document identity and catalog time',()=>{
 const project=validateMapProjectManifest(current);
 assert.deepEqual(project.document,{sourceRole:'territorial',identityPolicy:'runtime-instance'});
 assert.deepEqual(project.timeline,{sourceRole:'territorial',precision:'month',bounds:'catalog'});
 assert.deepEqual(project.resources.physicalLand.dependsOn,['terrain']);
 assert.deepEqual(project.resources.placeLifetimes.dependsOn,['places']);
 assert.deepEqual(project.resources.preparedMeshes.dependsOn,['territorial']);
 assert.equal(project.resources.preparedMeshes.required,false);
 assert.equal(project.resources.territorial.required,true);
 const identity=mapProjectDocumentIdentity(project,{format:'pandolab-project-state',documentId:'live-document-1'});
 assert.deepEqual(identity,{projectId:'default-world',documentId:'live-document-1',
  documentFormat:'pandolab-project-state',sourceRole:'territorial'});
 assert.throws(()=>mapProjectDocumentIdentity(project,{format:'other',documentId:'live-document-1'}),/format mismatch/);
 assert.throws(()=>mapProjectDocumentIdentity(project,{format:'pandolab-project-state',documentId:''}),/runtime document ID/);
});
test('a resource graph is cycle-free and required roles cannot depend on optional ones',()=>{
 assert.throws(()=>validateMapProjectManifest({...current,resources:{...current.resources,
  terrain:{...current.resources.terrain,dependsOn:['physicalLand']}}}),/Cyclic/);
 assert.throws(()=>validateMapProjectManifest({...current,resources:{...current.resources,
  territorial:{...current.resources.territorial,dependsOn:['preparedMeshes']}}}),/optional role/);
 assert.throws(()=>validateMapProjectManifest({...current,resources:{...current.resources,
  places:{...current.resources.places,dependsOn:['places']}}}),/dependencies/);
 assert.throws(()=>validateMapProjectManifest({...current,document:{sourceRole:'world',identityPolicy:'runtime-instance'}}),/document identity/);
 assert.throws(()=>validateMapProjectManifest({...current,timeline:{sourceRole:'territorial',precision:'day',bounds:'catalog'}}),/timeline/);
});
test('document-scoped resources invalidate on project, instance or pinned release change',()=>{
 const a=mapProjectResourceScope(current,{documentId:'doc-a',dataRevision:'rev-1'});
 const b=mapProjectResourceScope(current,{documentId:'doc-b',dataRevision:'rev-1'});
 const newer=mapProjectResourceScope(current,{documentId:'doc-a',dataRevision:'rev-2'});
 const alternate=mapProjectResourceScope({...current,projectId:'alternate-world'},{
  documentId:'doc-a',dataRevision:'rev-1'});
 assert.equal(a.catalogKey,b.catalogKey,'immutable catalog bytes may be reused for one revision');
 assert.notEqual(a.documentKey,b.documentKey,'per-document derived state must be isolated');
 assert.notEqual(a.documentKey,newer.documentKey,'a new release cannot reuse document state');
 assert.notEqual(a.catalogKey,newer.catalogKey,'a new release cannot reuse catalog contents');
 assert.notEqual(a.catalogKey,alternate.catalogKey,'a different project has its own catalog scope');
 assert.throws(()=>mapProjectResourceScope(current,{documentId:'',dataRevision:'rev-1'}),/scope identity/);
});
test('legacy v1 role-only declarations normalize without changing existing GIS paths',()=>{
 const oldManifest={...current};delete oldManifest.document;delete oldManifest.timeline;
 oldManifest.resources=Object.fromEntries(Object.entries(current.resources).map(([role,entry])=>[role,{catalog:entry.catalog}]));
 const normalized=validateMapProjectManifest(oldManifest);
 assert.deepEqual(normalized.document,validateMapProjectManifest(current).document);
 assert.deepEqual(normalized.timeline,validateMapProjectManifest(current).timeline);
 assert.deepEqual(mapProjectResourcePaths(normalized),mapProjectResourcePaths(current));
 assert.equal(normalized.resources.preparedMeshes.required,false);
});

test('river and lake catalogs cannot silently diverge from the shared Hydro renderer',()=>{
 assert.throws(()=>validateMapProjectManifest({...current,resources:{...current.resources,
  lakes:{catalog:'assets/data/alternate/lakes.json'}}}),/share one Hydro catalog/);
});
