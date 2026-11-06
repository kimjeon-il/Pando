import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasScenePackets } from '../../shared/frontend/js/modules/gpu-canvas-scene-packets.js';

test('Canvas packets keep geometry on the Worker until its source changes or the Worker restarts', () => {
  const packets = createCanvasScenePackets();
  const geometry = new Float64Array([0, 0, 1, 1]);
  const first = { key: 'land', sourceKey: 'v1', ringCoordinates: geometry, style: { color: '#fff' } };
  assert.equal(packets.delta([first], 'scene')[0].ringCoordinates, geometry);
  assert.equal(Object.hasOwn(packets.delta([first], 'scene')[0], 'ringCoordinates'), false);
  assert.equal(Object.hasOwn(packets.delta([], 'scene')[0] || {}, 'ringCoordinates'), false);
  assert.equal(packets.delta([first], 'scene')[0].ringCoordinates, geometry);
  packets.clear();
  assert.equal(packets.delta([first], 'scene')[0].ringCoordinates, geometry);
});

test('Canvas packet projections include current polygon, stroke and boundary fields', () => {
  const packets = createCanvasScenePackets();
  const polygon = { key: 'land', ringCoordinates: new Float64Array([0, 0]), role: 'physical-land', discarded: 1 };
  assert.equal(packets.scenePolygons([polygon])[0].ringCoordinates, polygon.ringCoordinates);
  assert.equal(Object.hasOwn(packets.scenePolygons([polygon])[0], 'discarded'), false);
  assert.deepEqual(packets.scenePolygons([{ key: 'empty' }]), []);
  assert.deepEqual(packets.sceneStrokes({ strokes: [{ key: 'coast', startsEnds: [0, 1], discarded: 1 }] }).map(row => row.key), ['coast']);
  assert.equal(packets.countryBoundary(null), null);
  assert.deepEqual(packets.countryBoundary({ segments: [1], outlineOverrides: { startsEnds: [2], ownerRanges: [], ownerIds: [], internalOwners: [] } }).segments, [1]);
});


test('Canvas raw physical packets preserve every ring, hole, water revision and allocation identity',()=>{
  const land={type:'MultiPolygon',coordinates:[
    [[[0,0],[4,0],[4,4],[0,0]],[[1,1],[2,1],[1,2],[1,1]]],
    [[[5,5],[6,5],[6,6],[5,5]]],
  ]};
  const water={type:'Polygon',coordinates:[[[7,7],[8,7],[8,8],[7,7]]]};
  const context={geometry:land,revision:'land-v8',water,waterRevision:'water-v9'};
  const a=createCanvasScenePackets(),first=a.physicalPolygons(context);
  assert.deepEqual(first.map(x=>x.role),['physical-land','physical-water']);
  assert.deepEqual([...first[0].ringOffsets],[0,4,8,12]);
  assert.deepEqual([...first[0].polygonOffsets],[0,2,3]);
  assert.equal(first[0].geometryRevision,'land-v8');
  assert.equal(first[1].geometryRevision,'water-v9');
  assert.equal(first[0].ringCoordinates.length,24);
  assert.equal(a.physicalPolygons(context)[0].ringCoordinates,first[0].ringCoordinates,
    'repeated views reuse one source allocation');
  const full=a.delta(first,'scene');
  assert.equal(full[0].ringCoordinates,first[0].ringCoordinates);
  const metadata=a.delta(a.physicalPolygons(context),'scene');
  assert.equal(Object.hasOwn(metadata[0],'ringCoordinates'),false,'unchanged physical source skips transport');
  const revised=a.physicalPolygons({...context,revision:'land-v10'});
  assert.notEqual(revised[0].sourceKey,first[0].sourceKey);
  const changed=a.delta(revised,'scene');
  assert.equal(changed[0].geometryRevision,'land-v10');
  assert.equal(Object.hasOwn(changed[0],'ringCoordinates'),false,
    'a revision-only metadata change reuses identical immutable geometry bytes');
  assert.deepEqual(a.physicalPolygons(null),[]);
});
test('malformed raw physical geometry cannot become an admitted Canvas packet',()=>{
  const a=createCanvasScenePackets();
  assert.throws(()=>a.physicalPolygons({geometry:{type:'MultiPolygon',coordinates:[[[[NaN,0],[1,0],[1,1],[NaN,0]]]]},revision:'bad'}),/nonfinite/);
});
