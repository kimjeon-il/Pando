import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveMapSurfacePresentation,selectCanvasPhysicalSource} from '../../../src/rendering/country-mesh-zoom-policy.js';
test('only accepted formal geometry admits map surfaces at every scale',()=>{
  for(const cssScale of [100,500,10000]) {
    assert.equal(resolveMapSurfacePresentation({cssScale,canonicalReady:false,
      previewReady:true,previewVerified:true}).quality,'pending');
    assert.equal(resolveMapSurfacePresentation({cssScale,canonicalReady:true,
      previewReady:true,previewVerified:true}).quality,'canonical');
  }
});
test('Canvas land source cannot use a separate certified preview before actual land admission',()=>{
  const hash='a'.repeat(64),preview={certified:true,geometry:{type:'Polygon',coordinates:[]},sourceRevision:hash,revision:hash};
  assert.equal(selectCanvasPhysicalSource({preview,sourceRevision:hash,state:{ready:false}}).source,null);
});
