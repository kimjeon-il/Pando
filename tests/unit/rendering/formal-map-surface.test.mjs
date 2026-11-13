import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveMapSurfacePresentation,selectCanvasPhysicalSource} from '../../../src/rendering/country-mesh-zoom-policy.js';
test('only accepted formal geometry admits map surfaces at every scale',()=>{
  for(const cssScale of [100,500,10000]) {
    assert.equal(resolveMapSurfacePresentation({cssScale,canonicalReady:false}).quality,'pending');
    assert.equal(resolveMapSurfacePresentation({cssScale,canonicalReady:true}).quality,'canonical');
  }
});
test('Canvas land source requires matching admitted physical revisions',()=>{
  const hash='a'.repeat(64),actual={geometry:{type:'Polygon',coordinates:[]},revision:hash};
  assert.equal(selectCanvasPhysicalSource({actual,state:{ready:false}}).source,null);
  assert.equal(selectCanvasPhysicalSource({actual,state:{ready:true,landRevision:'other'}}).source,null);
  assert.equal(selectCanvasPhysicalSource({actual,state:{ready:true,landRevision:hash}}).source,actual);
});
