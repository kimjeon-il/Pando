import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MAP_GEOMETRY_ERROR_PX,
  resolveScreenLodBucket,
  resolveScreenLodEdgeDegrees,
  createSharedPolygonLodIndex,
} from '../../../src/rendering/render-lod.js';

const aToB = [[4, 1], [3.5, 1.01], [3, 1], [2.5, 0.99], [2, 1],
  [1.5, 1.01], [1, 1], [0.5, 0.99], [0, 1]];
const countries = [
  { id: 'west', geometry: { type: 'Polygon', coordinates: [[
    [0, 0], [4, 0], ...aToB, [0, 0],
  ]] } },
  { id: 'east', geometry: { type: 'Polygon', coordinates: [[
    ...[...aToB].reverse(), [4, 2], [0, 2], [0, 1],
  ]] } },
];

test('sub-decimal distinct source vertices are never conflated into a shared node', () => {
  const tiny = [{ id: 'tiny', geometry: { type: 'Polygon', coordinates: [[
    [0, 0], [0.00000001, 0], [0.00000001, 0.00000001], [0, 0],
  ]] } }];
  const index = createSharedPolygonLodIndex(tiny);
  assert.deepEqual(index.derive({ cssScale: 100 }).features, tiny);
  assert.equal(index.stats().vertexCount, 3);
});

test('calibrated source tolerance respects the detail cap instead of forcing pixel accuracy', () => {
  const policy = { sourceHash: 'a'.repeat(64), algorithmVersion: 'shared-arcs-v1',
    referenceScale: 0.002, referenceToleranceMeters: 250, minimumToleranceMeters: 50 };
  const world = resolveScreenLodBucket({ cssScale: 100, scalePixelsPerMeter: 0.002,
    sourceHash: policy.sourceHash, policy });
  const regional = resolveScreenLodBucket({ cssScale: 1274201.76, scalePixelsPerMeter: 0.2,
    sourceHash: policy.sourceHash, policy });
  assert.equal(world.toleranceMeters, 250);
  assert.equal(regional.toleranceMeters, 50);
  assert.equal(regional.detailLimited, true);
  assert.ok(regional.errorPx > MAX_MAP_GEOMETRY_ERROR_PX);
  assert.notEqual(world.key, regional.key);
  assert.throws(() => resolveScreenLodBucket({ cssScale: 100, scalePixelsPerMeter: 0.002,
    sourceHash: 'b'.repeat(64), policy }), /source/i);
});

test('invalid calibration is rejected rather than silently using full source geometry', () => {
  const policy = { sourceHash: 'a'.repeat(64), algorithmVersion: 'shared-arcs-v1',
    referenceScale: 0.002, referenceToleranceMeters: 250, minimumToleranceMeters: 0 };
  assert.throws(() => resolveScreenLodBucket({ cssScale: 100, scalePixelsPerMeter: 0.002,
    sourceHash: policy.sourceHash, policy }), /tolerance|policy/i);
});

function sharedArc(features) {
  const west = features[0].geometry.coordinates[0];
  const east = features[1].geometry.coordinates[0];
  const westFrom = west.findIndex(([x, y]) => x === 4 && y === 1);
  const westTo = west.findIndex(([x, y]) => x === 0 && y === 1);
  const eastTo = east.findIndex(([x, y]) => x === 4 && y === 1);
  return [west.slice(westFrom, westTo + 1), [...east.slice(0, eastTo + 1)].reverse()];
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx
    + (point[1] - start[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

test('shared boundary uses exactly the same derivative with opposite winding', () => {
  const original = JSON.stringify(countries);
  const index = createSharedPolygonLodIndex(countries);
  const result = index.derive({ cssScale: 120 });
  const [west, east] = sharedArc(result.features);
  assert.deepEqual(west, east);
  assert.ok(index.stats().sharedEdgeCount >= 8);
  assert.ok(result.keptVertices < result.originalVertices);
  assert.equal(result.fallback, false);
  assert.equal(JSON.stringify(countries), original);
});

test('zoomed-in views retain vertices and screen deviation stays below the budget', () => {
  const index = createSharedPolygonLodIndex(countries);
  const scales = [100, 400, 1600, 6400];
  const variants = scales.map(cssScale => index.derive({ cssScale }));
  for (let i = 1; i < variants.length; i += 1)
    assert.ok(variants[i].keptVertices >= variants[i - 1].keptVertices);
  for (const [i, scale] of scales.entries()) {
    const oldRing = countries[0].geometry.coordinates[0];
    const newRing = variants[i].features[0].geometry.coordinates[0];
    for (const point of oldRing) {
      const deviation = Math.min(...newRing.slice(1).map((next, k) =>
        distanceToSegment(point, newRing[k], next)));
      assert.ok(deviation * Math.PI / 180 * scale < MAX_MAP_GEOMETRY_ERROR_PX + 1e-7);
    }
  }
});

test('LOD buckets always bound CSS scale, avoiding visible downgrade jitter', () => {
  const first = resolveScreenLodBucket({ cssScale: 500 });
  assert.ok(first.upperScale >= 500);
  const within = resolveScreenLodBucket({ cssScale: 505, previous: first });
  assert.equal(within.key, first.key);
  const zoomIn = resolveScreenLodBucket({ cssScale: 900, previous: within });
  assert.ok(zoomIn.upperScale >= 900);
  assert.ok(zoomIn.toleranceRadians <= MAX_MAP_GEOMETRY_ERROR_PX / 900);
});

test('object selection is outside the LOD contract and cannot restore source detail', () => {
  const index = createSharedPolygonLodIndex(countries);
  const result = index.derive({ cssScale: 120, selectedIds: ['west'] });
  assert.deepEqual(result.features, index.derive({ cssScale: 120 }).features);
  assert.ok(result.keptVertices < result.originalVertices);
  assert.deepEqual(...sharedArc(result.features));
});

test('hole-bearing and dateline-crossing polygons remain exact and unchanged', () => {
  const withHole = { id: 'hole', geometry: { type: 'Polygon', coordinates: [
    [[0, 0], [3, 0], [3, 1], [3, 3], [0, 3], [0, 0]],
    [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]],
  ] } };
  const withDateline = { id: 'date', geometry: { type: 'Polygon', coordinates: [[
    [179, 0], [-179, 0], [-179, 2], [179, 2], [179, 0],
  ]] } };
  const result = createSharedPolygonLodIndex([withHole, withDateline])
    .derive({ cssScale: 30 });
  assert.deepEqual(result.features[0].geometry, withHole.geometry);
  assert.deepEqual(result.features[1].geometry, withDateline.geometry);
});

test('invalid scale or unclosed rings cannot become an accepted derivative', () => {
  assert.throws(() => resolveScreenLodBucket({ cssScale: 0 }), TypeError);
  assert.throws(() => createSharedPolygonLodIndex([{
    id: 'invalid', geometry: { type: 'Polygon', coordinates: [[
      [0, 0], [1, 0], [1, 1], [0, 1],
    ]] },
  }]), TypeError);
  assert.throws(() => createSharedPolygonLodIndex([countries[0],countries[0]]), /unique source IDs/);
});

test('polar rings and date-line rings retain source identity at every fractional scale', () => {
  const polar={id:'polar',geometry:{type:'Polygon',coordinates:[[
    [-180,85],[-90,86],[0,85],[90,86],[180,85],[180,90],[-180,90],[-180,85],
  ]]}};
  const date={id:'date',geometry:{type:'Polygon',coordinates:[[
    [179,-2],[-179,-2],[-178,0],[-179,2],[179,2],[178,0],[179,-2],
  ]]}};
  const index=createSharedPolygonLodIndex([polar,date]);
  for(const cssScale of [1,1.5,2,4,8,16,32,4096]){
    const result=index.derive({cssScale,capped:true});
    assert.deepEqual(result.features,[polar,date]);
    assert.equal(result.fallback,false);
  }
});

test('differently split coincident boundaries are protected without snapping source coordinates', () => {
  const source=[
    {id:'west',geometry:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}},
    {id:'east',geometry:{type:'Polygon',coordinates:[[[2,0],[4,0],[4,2],[2,2],[2,1],[2,0]]]}},
    {id:'north',geometry:{type:'Polygon',coordinates:[[[2,2],[4,2],[4,4],[2,4],[2,2]]]}},
  ];
  const index=createSharedPolygonLodIndex(source);
  assert.equal(index.stats().sharedEdgeCount,1,'only exact source edges are shared; no invented split');
  for(const cssScale of [1,32,1000]){
    const result=index.derive({cssScale});
    for(let i=0;i<source.length;i++){
      assert.ok(result.features[i].geometry.coordinates[0].some(p=>p[0]===2&&p[1]===2),'triple contact retained');
      assert.ok(result.features[i].geometry.coordinates[0].every(point=>source[i].geometry.coordinates[0]
        .some(original=>point[0]===original[0]&&point[1]===original[1])));
    }
    assert.ok(result.features[1].geometry.coordinates[0].some(p=>p[0]===2&&p[1]===1));
  }
});


test('viewport scoping excludes nonvisible polygons without renumbering country slots', () => {
  const source = JSON.stringify(countries);
  const index = createSharedPolygonLodIndex(countries);
  const scoped = index.derive({ cssScale: 400, visibleIds: ['west'] });
  assert.equal(scoped.scoped, true);
  assert.equal(scoped.visibleCountryCount, 1);
  assert.equal(scoped.features.length, 2);
  assert.equal(scoped.features[0].id, 'west');
  assert.equal(scoped.features[1].id, 'east');
  assert.equal(scoped.features[1].geometry, null);
  assert.ok(scoped.features[0].geometry.coordinates[0].length >= 4);
  assert.equal(JSON.stringify(countries), source);
  const restored = index.derive({ cssScale: 400, visibleIds: ['east'] });
  assert.equal(restored.features[0].geometry, null);
  assert.ok(restored.features[1].geometry);
});

test('screen LOD rejects invalid screen tolerances in both scoped and global paths', () => {
  const index = createSharedPolygonLodIndex(countries);
  for (const cssScale of [NaN, -1, 0, Infinity])
    assert.throws(() => index.derive({ cssScale }), TypeError);
  for (const errorPx of [NaN, -1, 0, Infinity])
    assert.throws(() => index.derive({ cssScale: 100, errorPx }), TypeError);
});

test('ring start offset and reverse winding do not create a mismatched shared arc', () => {
  const west = structuredClone(countries[0]);
  const east = structuredClone(countries[1]);
  const ring = east.geometry.coordinates[0];
  const open = ring.slice(0, -1);
  const offset = 3;
  const rotated = [...open.slice(offset), ...open.slice(0, offset)];
  east.geometry.coordinates[0] = [...rotated, rotated[0]];
  const index = createSharedPolygonLodIndex([west, east]);
  const low = index.derive({ cssScale: 80 });
  const high = index.derive({ cssScale: 16000 });
  assert.equal(low.fallback, false);
  assert.equal(high.fallback, false);
  assert.ok(low.keptVertices <= high.keptVertices);
  // A shared edge's internal source vertices either survive on both sides
  // or are eliminated on both sides, independent of ring start offsets.
  const kept = new Set(low.features[0].geometry.coordinates[0]
    .map(value => value.join(',')));
  for (const point of aToB.slice(1, -1)) {
    const key = point.join(',');
    assert.equal(kept.has(key), low.features[1].geometry.coordinates[0]
      .some(value => value.join(',') === key));
  }
});

test('spherical mesh edge subdivision gets finer with zoom and stays under the CSS error budget', () => {
  const levels = [100, 250, 1000, 4000, 16000];
  const edges = levels.map(cssScale => resolveScreenLodEdgeDegrees({ cssScale }));
  assert.equal(edges.length, levels.length);
  for (let index = 0; index < levels.length; index++) {
    if (index) assert.ok(edges[index] <= edges[index - 1]);
    const radians = edges[index] * Math.PI / 180;
    const sagittaPx = levels[index] * (1 - Math.cos(radians / 2));
    assert.ok(sagittaPx <= MAX_MAP_GEOMETRY_ERROR_PX + 1e-9);
  }
  assert.ok(edges[0] > edges.at(-1));
  assert.throws(() => resolveScreenLodEdgeDegrees({ cssScale: 0 }), TypeError);
});

test('small island is preserved without rejecting the other country LOD', () => {
  const island = { id: 'island', geometry: { type: 'Polygon', coordinates: [[
    [10, 10], [10.0001, 10], [10.0001, 10.0001], [10, 10.0001], [10, 10],
  ]] } };
  const mainland = { id: 'mainland', geometry: { type: 'Polygon', coordinates: [[
    [0, 0], [2, 0], [2, 1], [1.5, 1.0001], [1, 1], [0.5, 1.0001], [0, 1], [0, 0],
  ]] } };
  const result = createSharedPolygonLodIndex([island, mainland])
    .derive({ cssScale: 100, errorPx: 2 });
  assert.equal(result.fallback, false);
  assert.deepEqual(result.features[0].geometry, island.geometry);
  assert.ok(result.keptVertices < result.originalVertices);
});

test('a protected offscreen neighbor constrains the same shared arc', () => {
  const source=structuredClone(countries);
  source[1].geometry.coordinates.push([[1,1.4],[1.2,1.4],[1.2,1.6],[1,1.4]]);
  const index=createSharedPolygonLodIndex(source);
  const result=index.derive({cssScale:80,visibleIds:['west']});
  for(const point of aToB)assert.ok(result.features[0].geometry.coordinates[0]
    .some(candidate=>candidate[0]===point[0]&&candidate[1]===point[1]));
  assert.equal(result.features[1].geometry,null);
});

test('display hierarchy never adds a contact with an isolated island across a concave coast', () => {
  const mainland={id:'main',geometry:{type:'Polygon',coordinates:[[
    [0,0],[4,0],[4,4],[3,4],[3,1],[1,1],[1,4],[0,4],[0,0],
  ]]}};
  const island={id:'island',geometry:{type:'Polygon',coordinates:[[
    [1.8,2],[2.2,2],[2.2,2.4],[1.8,2.4],[1.8,2],
  ]]}};
  const index=createSharedPolygonLodIndex([mainland,island]);
  const inside=(ring,[x,y])=>{let result=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])result=!result;
  }return result;};
  let previous=null;
  for(const cssScale of [1,2,4,16,64,256,1024]){
    const result=index.derive({cssScale});
    assert.equal(result.fallback,false);
    const ring=result.features[0].geometry.coordinates[0];
    assert.equal(inside(ring,[2,2.2]),false);
    if(previous)for(const point of previous)assert.ok(ring.some(p=>p[0]===point[0]&&p[1]===point[1]));
    previous=ring;
  }
});

test('derived geometry retains explicit original coordinate indices for every displayed ring',()=>{
  const index=createSharedPolygonLodIndex(countries),result=index.derive({cssScale:100});
  for(let f=0;f<countries.length;f++){
    const indices=result.sourceIndices[f][0][0],points=result.features[f].geometry.coordinates[0];
    assert.deepEqual(points,indices.map(i=>countries[f].geometry.coordinates[0][i]));
  }
});

test('dense immutable physical rings do not allocate a mutable contraction graph', () => {
  const count=12000;
  const ring=Array.from({length:count},(_,i)=>{
    const angle=i/count*Math.PI*2;
    return [20+Math.cos(angle)*4,40+Math.sin(angle)*4];
  });
  ring.push(ring[0]);
  const physical={id:'physical-land',geometry:{type:'Polygon',coordinates:[ring,
    [[20,40],[20,41],[21,41],[21,40],[20,40]]]}};
  const progress=[];
  const index=createSharedPolygonLodIndex([physical],{onProgress:value=>progress.push(value)});
  assert.equal(index.stats().graphVertexCount,0);
  assert.equal(index.stats().immutableProtectedVertexCount,count+4);
  assert.ok(index.stats().preparationMs>=0);
  assert.deepEqual(progress.map(value=>value.phase),['source-graph','importance','topology']);
  const display=index.derive({cssScale:100,capped:true});
  assert.deepEqual(display.features[0].geometry,physical.geometry);
  assert.equal(display.sourceIndices[0][0][0].length,count+1);
});
