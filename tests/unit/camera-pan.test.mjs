import {test} from 'node:test';
import assert from 'node:assert/strict';
import {panCameraView} from "../../shared/frontend/js/modules/camera-pan.js";
test('both hosts share globe sensitivity, flat longitude wrapping and latitude clamps',()=>{
 const view={globeRotation:[0,0,0],globeZoom:4,flatCenter:[179,0]};
 assert.equal(panCameraView(view,'globe',100,100),true);
 assert.deepEqual(view.globeRotation,[11,-11,0]);
 panCameraView(view,'globe',0,10000);assert.equal(view.globeRotation[1],-89);
 panCameraView(view,'flat',-10,1000,{scale:180/Math.PI});
 assert.deepEqual(view.flatCenter,[-171,85]);
 assert.equal(panCameraView(view,'flat',0,0,{scale:1}),false);
});
