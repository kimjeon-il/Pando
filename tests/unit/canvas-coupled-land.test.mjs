import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('Canvas land uses the admitted physical packet independently from countries', () => {
  const scope={};vm.runInNewContext(readFileSync(new URL('../../assets/js/workers/canvas-scene-composition-core.js',import.meta.url),'utf8'),scope);
  const geometry={type:'Polygon',coordinates:[[[0,0],[1,0],[0,1],[0,0]]]},paths=[];
  const context={beginPath(){},fill(){}};
  const packet={role:'physical-land',ringCoordinates:new Float64Array([5,5,6,5,5,6,5,5]),ringOffsets:[0,4],polygonOffsets:[0,1]};
  scope.PandoLabCanvasSceneComposition.drawGeneralLand(context,value=>paths.push(value),[packet]);
  assert.equal(paths.length,1);
  assert.notEqual(paths[0],geometry);
  assert.deepEqual(JSON.parse(JSON.stringify(paths[0].coordinates)),[[[[5,5],[6,5],[5,6],[5,5]]]]);
  assert.equal(scope.PandoLabCanvasSceneComposition.generalLandShapes([packet])[0],paths[0],
    'country deletion, including the last country, cannot replace or erase physical land');
});

test('Canvas pending surface suppresses regional fills as well as country fills', () => {
  const scope={};vm.runInNewContext(readFileSync(new URL('../../assets/js/workers/canvas-scene-composition-core.js',import.meta.url),'utf8'),scope);
  scope.PandoLabCanvasSceneComposition.drawTerritorialFills(new Proxy({}, {get(){assert.fail('pending territorial fill touched the Canvas');}}),
    ()=>assert.fail('pending territorial fill drew a path'),[{role:'territorial-fill'}],null,1,{quality:'pending'});
});
