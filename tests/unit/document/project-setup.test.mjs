import test from 'node:test';import assert from 'node:assert/strict';import {normalizeProjectSetup,initialBoundsView,createBuiltinProjectSetup} from "../../../src/document/project-setup.js";import {createMapLayoutMetricsSnapshot} from "../../../src/map/map-layout-metrics.js";
test('initial bounds fit both viewport dimensions including wide desktop and dateline',()=>{for(const size of [{width:2560,height:900},{width:390,height:844}]){const layout=createMapLayoutMetricsSnapshot(size);const result=initialBoundsView({west:170,east:-180,south:40,north:50},layout);assert.equal(result.view.flatCenter[0],175);assert.ok(layout.flatBaseScale*result.view.flatZoom*10*Math.PI/180<=layout.contentHeight);assert.ok(layout.flatBaseScale*result.view.flatZoom*10*Math.PI/180<=layout.contentWidth);}});
test('valid settings preserve future and BCE month ranges and date-line bounds',()=>{for(const initialMonth of ['-0044-03','2026-10','3000-12']){const input={initialMonth,timelineRange:null,initialMapBounds:{west:170,east:-170,south:-10,north:10},sourceMode:'empty'};assert.deepEqual(normalizeProjectSetup(input),input);}});

test('builtin map setup has exactly one project-shaped source for each month',()=>{
 for(const month of ['1914-07','2026-10','3000-12']) {
  const built=createBuiltinProjectSetup(month);
  assert.deepEqual(built,normalizeProjectSetup({
   initialMonth:month,timelineRange:null,initialMapBounds:null,sourceMode:'builtin',
  }));
  assert.equal(Object.hasOwn(built,'timelineCursor'),false);
 }
 const one=createBuiltinProjectSetup('2026-10'),two=createBuiltinProjectSetup('2026-10');
 assert.notStrictEqual(one,two,'a mutable project setup is not shared between document instances');
 one.initialMonth='2000-01';
 assert.equal(two.initialMonth,'2026-10');
});
