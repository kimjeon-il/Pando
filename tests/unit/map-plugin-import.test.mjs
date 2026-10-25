import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createGenericFeatureService } from "../../apps/editor/frontend/js/modules/generic-feature-service.js";
import { createJob, sealJob, reviseJob, jobFeatures } from '../../plugins/pando-map-tools/lib/jobs.mjs';
import { core } from '../../plugins/pando-map-tools/lib/workspace.mjs';

export function reviewedFixture() {
  const width=31,labels=new Uint8Array(width*width),confidence=new Float32Array(width*width).fill(1);
  for(const [lo,hi] of [[2,28],[10,20]]) {
    for(let x=lo;x<=hi;x++) labels[lo*width+x]=labels[hi*width+x]=1;
    for(let y=lo;y<=hi;y++) labels[y*width+lo]=labels[y*width+hi]=1;
  }
  for(let y=2;y<=10;y++) labels[y*width+15]=1;
  let job=createJob({path:'test-map.png',sha256:'d'.repeat(64),width,height:width},{dataRevision:'test'});
  job.graph=core.referenceBoundaryGraph(width,width,labels,confidence,{threshold:.55,simplifyTolerance:0});job.status='needs-review';job=sealJob(job);
  job=reviseJob(job,{type:'control-points',mode:'affine',points:[{id:'a',image:[0,0],coordinate:[10,50]},{id:'b',image:[1,0],coordinate:[20,50]},{id:'c',image:[0,1],coordinate:[10,40]}]});
  return reviseJob(job,{type:'review',georeference:true,boundaries:true,selectedIds:['line:0',...job.graph.faces.map(f=>'face:'+f.id)]});
}
test('reviewed plugin holes and lines import atomically, edit, undo redo and reopen via real Core',async()=>{
  const collection=jobFeatures(reviewedFixture());
  assert.ok(collection.features.some(f=>f.geometry.type==='Polygon' && f.geometry.coordinates.length===2));
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url)));
  const owner=await createNodeCoreProject(seed,{appVersion:'plugin-test'});let reopened;
  try {
    const service=createGenericFeatureService({documentModel:owner.documentModel,commandOwner:owner.project});
    const before=service.list().length;
    const created=await service.addMany(collection.features);
    assert.equal(service.list().length,before+created.length);
    await owner.project.undo();assert.equal(service.list().length,before);
    await owner.project.redo();assert.equal(service.list().length,before+created.length);
    await service.updateMetadata(created[0].id,'name','Reviewed map line');
    assert.equal(service.get(created[0].id).properties.name,'Reviewed map line');
    const {project}=await owner.project.buildFileSnapshot();
    reopened=await createNodeCoreProject(project);
    const saved=createGenericFeatureService({documentModel:reopened.documentModel,commandOwner:reopened.project});
    assert.deepEqual(saved.list(),service.list());
    assert.equal(saved.get(created[0].id).properties.source.details.historicalAccuracy,'unverified');
  } finally {reopened?.dispose();owner.dispose();}
});
