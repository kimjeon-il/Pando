import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../assets/js/', import.meta.url);
function runtime() {
  const scope = { URL, location: { href: 'https://example.test/assets/js/workers/canvas-render-worker.js' }, importScripts() {} };
  scope.self = scope;
  vm.createContext(scope);
  vm.runInContext(readFileSync(new URL('vendor/d3.min.js', root), 'utf8'), scope);
  const source = readFileSync(new URL('workers/canvas-render-worker.js', root), 'utf8');
  const anchor = 'self.onmessage = event => {';
  assert.ok(source.includes(anchor));
  vm.runInContext(source.replace(anchor, "self.setHydroForTest = features => { hydroEditFeatures = features; }; self.hydroPassForTest = renderHydroPass; self.projectionForTest = createProjection; self.cachedPathForTest = typeof createCanvasPath === 'function' ? createCanvasPath : undefined; " + anchor), scope);
  return scope;
}

test('zoomed Canvas globe clips projected land and mask paths to the frame without losing viewport crossings', () => {
  const scope = runtime(), width = 1280, height = 752;
  for (const zoom of [1, 16, 64]) {
    const projection = scope.projectionForTest({ projection: 'globe', view: { globeZoom: zoom, globeRotation: [-114.17, -22.27, 0] } }, width, height);
    const points = [];
    const context = { moveTo: (x, y) => points.push([x, y]), lineTo: (x, y) => points.push([x, y]), closePath() {} };
    scope.d3.geo.path().projection(projection).context(context)({ type: 'Sphere' });
    assert.ok(points.length > 3, 'the visible globe must remain drawable');
    assert.ok(points.every(([x,y]) => x >= -6 - 1e-6 && x <= width + 6 + 1e-6 && y >= -6 - 1e-6 && y <= height + 6 + 1e-6),
      `zoom ${zoom}: offscreen globe paths must not reach Canvas rasterization`);
    if (zoom > 1) {
      assert.ok(points.some(([x]) => Math.abs(x + 6) < 1e-6));
      assert.ok(points.some(([x]) => Math.abs(x - width - 6) < 1e-6));
    }
    assert.equal(projection.clipAngle(), 90, 'retain far hemisphere clipping');
  }
});

test('Canvas reuses exact projected paths across land, terrain and paint-only frames, and invalidates view or geometry changes', () => {
  const scope = runtime();
  assert.equal(typeof scope.cachedPathForTest, 'function');
  const geometry = { type: 'LineString', coordinates: [[113,22], [114,23], [115,22]] };
  const frame = { projection:'globe', view:{globeZoom:16,globeRotation:[-114.17,-22.27,0]} };
  const projection = scope.projectionForTest(frame,1280,752), points=[];
  const target={moveTo:(x,y)=>points.push(['M',x,y]),lineTo:(x,y)=>points.push(['L',x,y]),closePath:()=>points.push(['Z']),arc:(...args)=>points.push(['A',...args])};
  let traversals=0;
  Object.defineProperty(geometry,'coordinates',{get(){traversals++;return [[113,22],[114,23],[115,22]];}});
  const path=scope.cachedPathForTest(projection,target);
  path(geometry);const first=structuredClone(points);points.length=0;
  path({type:'Feature',geometry,properties:{color:'#123456'}});
  assert.deepEqual(points,first);assert.equal(traversals,1);
  const next=scope.cachedPathForTest(scope.projectionForTest(frame,1280,752),target);
  next(geometry);assert.equal(traversals,1,'style-only frames reuse exact projected geometry');
  scope.cachedPathForTest(scope.projectionForTest({...frame,view:{...frame.view,globeZoom:32}},1280,752),target)(geometry);
  assert.equal(traversals,2,'camera changes invalidate paths');
  const replacement={type:'LineString',coordinates:[[114,22],[115,22]]};
  scope.cachedPathForTest(projection,target)(replacement);
  points.length=0;
  scope.cachedPathForTest(projection,target)(geometry);
  assert.deepEqual(points,first);
});



test('Canvas river paints reuse projected segments without changing per-segment widths or water colors', () => {
  const scope=runtime();
  let coordinateReads=0; const coordinate=values=>new Proxy(values,{get(target,key){if(key==='0'||key==='1')coordinateReads++;return target[key];}});
  const geometry={type:'LineString',coordinates:[[113,22],[114,22.5],[115,22]].map(coordinate)};
  scope.setHydroForTest([{type:'Feature',geometry,properties:{category:'river',stroke_widths:[[1,3,5]]}}]);
  const message={riversVisible:true,lakesVisible:true,theme:{ocean:'#123456',riverOpacity:.7,strokes:{river:{width:2}}}};
  const frame={projection:'globe',view:{globeZoom:16,globeRotation:[-114.17,-22.27,0]}};
  const projection=scope.projectionForTest(frame,1280,752), widths=[], colors=[], commands=[];
  const target={save(){},restore(){},setTransform(){},beginPath(){},moveTo:(x,y)=>commands.push([x,y]),lineTo:(x,y)=>commands.push([x,y]),stroke(){widths.push(this.lineWidth);colors.push(this.strokeStyle);}};
  let streams=0;const original=projection.stream;
  projection.stream=function(...args){streams++;return original.apply(this,args);};
  scope.hydroPassForTest(message,projection,1,'river',target);
  const first=structuredClone(commands), readsAfterFirst=coordinateReads;commands.length=0;
  scope.hydroPassForTest(message,projection,1,'river',target);
  assert.deepEqual(commands,first);
  assert.deepEqual(widths,[4,8,4,8]);assert.deepEqual(colors,Array(4).fill('#123456'));
  assert.equal(streams,1,'one D3 stream compiles all segments in a paint');assert.equal(coordinateReads,readsAfterFirst,'unchanged segments must not be reprojected');
});

test('cached Canvas paths preserve D3 polygon holes, disjoint islands, globe clipping and point arcs exactly', () => {
  const scope=runtime();
  const ring=[[113,22],[113,23],[114,23],[114,22],[113,22]];
  const hole=[[113.2,22.2],[113.8,22.2],[113.8,22.8],[113.2,22.8],[113.2,22.2]];
  const shapes=[{type:'Polygon',coordinates:[ring,hole]},
    {type:'MultiPolygon',coordinates:[[ring],[ring.map(([x,y])=>[x+1,y])]]},
    {type:'Point',coordinates:[114,22]}, {type:'Sphere'}, {type:'Feature',geometry:null,properties:{}}];
  for(const zoom of [1,16]) {
    const projection=scope.projectionForTest({projection:'globe',view:{globeZoom:zoom,globeRotation:[-114,-22,0]}},1280,752);
    const record=rows=>({moveTo:(x,y)=>rows.push(['M',x,y]),lineTo:(x,y)=>rows.push(['L',x,y]),closePath:()=>rows.push(['Z']),
      arc:(x,y,r,start,end,reverse=false)=>rows.push(['A',x,y,r,start,end,Boolean(reverse)])});
    for(const shape of shapes) {
      const direct=[],cached=[];
      scope.d3.geo.path().projection(projection).context(record(direct))(shape);
      const path=scope.cachedPathForTest(projection,record(cached));path(shape);
      assert.deepEqual(cached,direct);
      cached.length=0;path(shape);assert.deepEqual(cached,direct);
    }
  }
});

test('Canvas globe retains strokes whose centers sit outside the viewport but whose ink overlaps its edge', () => {
  const scope=runtime();
  for(const [width,outside] of [[4,-1],[40,-15]]) {
    const projection=scope.projectionForTest({projection:'globe',view:{globeZoom:16,globeRotation:[-114,-22,0]},theme:{strokes:{country:{width,join:'round',cap:'round'}}}},1280,752);
    const points=[];
    const geometry={type:'LineString',coordinates:[projection.invert([outside,340]),projection.invert([outside,410])]};
    scope.d3.geo.path().projection(projection).context({moveTo:(x,y)=>points.push([x,y]),lineTo:(x,y)=>points.push([x,y])})(geometry);
    assert.ok(points.length>=2,'visible stroke overlap must not disappear at the canvas edge');
  }
});
