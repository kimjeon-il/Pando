import { describe as featureDescribe } from 'node:test';
import * as __suiteDependency0 from "node:test";
import * as __suiteDependency1 from "node:assert/strict";
import * as __suiteDependency2 from "../../shared/frontend/js/modules/gpu-map-renderer.js";
import * as __suiteDependency3 from "../../shared/frontend/js/modules/geometry-versions.js";
import * as __suiteDependency4 from "node:assert/strict";
import * as __suiteDependency5 from "node:fs";
import * as __suiteDependency6 from "node:vm";
import * as __suiteDependency7 from "node:test";
import * as __suiteDependency8 from "node:assert/strict";
import * as __suiteDependency9 from "node:test";
import "../../shared/frontend/js/workers/canvas-scene-composition-core.js";

// Original feature contract: canvas-country-geometry.test.mjs
featureDescribe("canvas-country-geometry", () => {
  const test = __suiteDependency0.default;
  const assert = __suiteDependency1.default;
  const {  canvasCountryGeometrySignature  } = __suiteDependency2;
  const {  touchGeometry  } = __suiteDependency3;
const feature = id => ({ id, geometry: { type:'Polygon', coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]] },
  properties: { entityKind:'general', style:{} } });

test('Canvas country data identity ignores presentation wrappers but follows geometry and membership', () => {
  const root=feature('CHN'), child=feature('HKG');
  child.boundaryRootId='CHN';child.boundaryPristine=true;
  const rows=[root,child], key=canvasCountryGeometrySignature(rows);
  assert.equal(canvasCountryGeometrySignature(rows.map(row=>({...row,properties:{...row.properties,style:{color:'#ff0000'}}}))),key);
  assert.notEqual(canvasCountryGeometrySignature([root]),key);
  assert.notEqual(canvasCountryGeometrySignature([child,root]),key);
  assert.notEqual(canvasCountryGeometrySignature([root,{...child,id:'MAC'}]),key);
  assert.notEqual(canvasCountryGeometrySignature([root,{...child,geometry:structuredClone(child.geometry)}]),key);
  assert.notEqual(canvasCountryGeometrySignature([root,{...child,boundaryRootId:'OTHER'}]),key);
  assert.notEqual(canvasCountryGeometrySignature([root,{...child,boundaryPristine:false}]),key);
  touchGeometry(child.geometry);
  assert.notEqual(canvasCountryGeometrySignature(rows),key);
});
});
// Original feature contract: canvas-coupled-land.test.mjs
featureDescribe("canvas-coupled-land", () => {
  const assert = __suiteDependency4.default;
  const {  readFileSync  } = __suiteDependency5;
  const vm = __suiteDependency6.default;
  const test = __suiteDependency7.default;
test('Canvas land uses the admitted physical packet independently from countries', () => {
  const scope={};vm.runInNewContext(readFileSync(new URL("../../shared/frontend/js/workers/canvas-scene-composition-core.js",import.meta.url),'utf8'),scope);
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
  const scope={};vm.runInNewContext(readFileSync(new URL("../../shared/frontend/js/workers/canvas-scene-composition-core.js",import.meta.url),'utf8'),scope);
  scope.PandoLabCanvasSceneComposition.drawTerritorialFills(new Proxy({}, {get(){assert.fail('pending territorial fill touched the Canvas');}}),
    ()=>assert.fail('pending territorial fill drew a path'),[{role:'territorial-fill'}],null,1,{quality:'pending'});
});
});
// Original feature contract: canvas-stroke-preparation.test.mjs
featureDescribe("canvas-stroke-preparation", () => {
  const assert = __suiteDependency8.default;
  const test = __suiteDependency9.default;
const draw = globalThis.PandoLabCanvasSceneComposition.drawStrokes;
const context = () => ({ save() {}, restore() {}, setLineDash() {}, beginPath() {}, stroke() {} });
const fixture = () => ({ geometryRevision: 'shape:1', startsEnds: new Float32Array([0, 0, 1, 0, 1, 0, 2, 0]),
  ownerRanges: { LEFT: { first: 0, count: 1 }, RIGHT: { first: 1, count: 1 } },
  ownerIds: ['LEFT', 'RIGHT'], style: { alpha: 1, color: '#ffffff', width: 1 } });

test('Canvas reuses prepared shared coordinates across pan/style paints while projecting each frame', () => {
  const packet = fixture(), target = context(), paints = [];
  draw(target, geometry => paints.push({ geometry, view: 'first' }), [packet]);
  draw(target, geometry => paints.push({ geometry, view: 'panned' }), [{ ...packet,
    style: { ...packet.style, color: '#123456', width: 2 } }]);
  assert.equal(paints.length, 2);
  assert.strictEqual(paints[0].geometry, paints[1].geometry);
  assert.notEqual(paints[0].view, paints[1].view);
  assert.deepEqual(paints[0].geometry.coordinates, [[[0, 0], [1, 0], [2, 0]]]);
  assert.equal(target.strokeStyle, '#123456');
  assert.equal(target.lineWidth, 2);
});

test('Canvas owner selection uses only current ranges and reuses a restored selection', () => {
  const packet = fixture(), paints = [], target = context();
  const paint = ownerIds => draw(target, geometry => paints.push(geometry), [{ ...packet, ownerIds }]);
  paint(['LEFT', 'RIGHT']); paint(['LEFT']); paint(['RIGHT']); paint(['LEFT', 'RIGHT']);
  assert.deepEqual(paints[1].coordinates, [[[0, 0], [1, 0]]]);
  assert.deepEqual(paints[2].coordinates, [[[1, 0], [2, 0]]]);
  assert.strictEqual(paints[0], paints[3]);
});

test('Canvas invalidates prepared strokes on changed revision, buffer identity or actual range layout', () => {
  const packet = fixture(), target = context(), paints = [];
  const paint = current => draw(target, geometry => paints.push(geometry), [current]);
  paint(packet);
  packet.startsEnds[6] = 3;
  paint({ ...packet, geometryRevision: 'shape:2' });
  assert.notStrictEqual(paints[0], paints[1]);
  assert.equal(paints[0].coordinates[0].at(-1)[0], 2);
  assert.equal(paints[1].coordinates[0].at(-1)[0], 3);
  paint({ ...packet, startsEnds: packet.startsEnds.slice(), geometryRevision: 'shape:2' });
  assert.notStrictEqual(paints[1], paints[2]);
  paint({ ...packet, geometryRevision: 'shape:2', ownerIds: ['LEFT'], ownerRanges: { LEFT: { first: 1, count: 1 } } });
  assert.deepEqual(paints[3].coordinates, [[[1, 0], [3, 0]]]);
});
});
