import assert from 'node:assert/strict';
import test from 'node:test';
import {collectViewerInspection} from '../../apps/viewer/js/modules/viewer-inspector-state.js';
import {readFileSync} from 'node:fs';

test('viewer diagnostics are bounded and preserve actual renderer pending states',()=>{
  const evidence=collectViewerInspection({
    rendererStats:{renderer:'canvas-worker',mapReadiness:{status:'terrain'},
      canonicalMeshReady:true,terrainReady:false,countryVisibleCount:253,
      projectGeneration:4,countriesPublishedGeneration:4,
      requestedRevision:9,displayedRevision:8,
      committedGeometryRevision:6,displayedGeometryRevision:5,
      projectRenderBlocked:false},
    documentSnapshot:{documentId:'pando-fixture',territorialEntities:[{},{}]},territorialCount:2,
    meta:{dataRevision:'a'.repeat(40)},month:'2026-10',readOnly:true,
    capturedAt:'2026-11-05T00:00:00Z'
  });
  assert.equal(evidence.schema,'pando-viewer-inspection-v1');
  assert.equal(evidence.map.presentation,'terrain');
  assert.equal(evidence.map.terrainReady,false);
  assert.equal(evidence.map.frameAcknowledged,false);
  assert.equal(evidence.map.countryCount,253);
  assert.equal(evidence.data.documentEntities,2);
  assert.doesNotMatch(readFileSync(new URL('../../apps/viewer/js/modules/viewer-inspector-state.js',import.meta.url),'utf8'),/\.territorialEntities/);
  assert.equal(evidence.data.readOnly,true);
  assert.match(evidence.data.topologyValidation,/미실행/);
  assert.equal(evidence.performance.available,false);
  assert.equal(evidence.performance.longTaskCount,null);
  assert.equal(evidence.errors.length,0);
});
test('inspection does not copy entire documents, sensitive stacks or unbounded errors',()=>{
  const events=Array.from({length:90},(_,i)=>({
    category:'renderer',errorCode:'PL-TEST-'+i,
    technicalMessage:'x'.repeat(900),stack:'SECRET_STACK',
    privateToken:'SECRET_TOKEN'
  }));
  const info=collectViewerInspection({
    documentSnapshot:{documentId:'doc-id',territorialEntities:[{secret:'NEVER_EXPORT'}],
      sourceToken:'SECRET_DOCUMENT'},
    rendererStats:{displayedRevision:3,requestedRevision:3,
      displayedGeometryRevision:6,committedGeometryRevision:6},
    diagnosticEvents:events,
    performanceReport:{browser:{navigation:{domInteractiveMs:421}},
      longTasks:{count:3,totalMs:111},memory:[{},{}]},
  });
  assert.equal(info.map.frameAcknowledged,true);
  assert.equal(info.errors.length,20);
  assert.equal(info.errors[0].errorCode,'PL-TEST-89');
  assert.equal(info.errors[0].message.length,300);
  assert.equal(info.performance.available,true);
  assert.equal(info.performance.domInteractiveMs,421);
  assert.equal(info.performance.memorySamples,2);
  assert.doesNotMatch(JSON.stringify(info),/SECRET_STACK|SECRET_TOKEN|NEVER_EXPORT|SECRET_DOCUMENT/);
});
