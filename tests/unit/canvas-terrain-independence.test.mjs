import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workerSource = readFileSync(new URL("../../shared/frontend/js/workers/canvas-render-worker.js", import.meta.url), 'utf8');
const terrainCoreSource = readFileSync(new URL("../../shared/frontend/js/workers/canvas-terrain-dem-core.js", import.meta.url), 'utf8');
const manifest = { gutter: 1, urlTemplate: 'terrain/v0.12.6/{level}/{column}-{row}.webp', levels: [
  { id: 0, width: 1350, height: 675, columns: 2, rows: 1, tileSize: 1024 },
  { id: 1, width: 2700, height: 1350, columns: 3, rows: 2, tileSize: 1024 },
  { id: 2, width: 5400, height: 2700, columns: 6, rows: 3, tileSize: 1024 },
] };
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };

function canvasTerrainRuntime({ expectDem = false } = {}) {
  const messages = [], requests = [], drawn = [], paths = [], substrates = [], triangleCopies = [];
  class Canvas {
    constructor(width, height) { this.width = width; this.height = height; this.ctx = null; }
    getContext() {
      if (!this.ctx) {
        const canvas = this;
        this.ctx = {
          canvas, setTransform() {}, clearRect() {}, save() {}, restore() {}, beginPath() {},
          moveTo() {}, lineTo() {}, arc() {}, closePath() {}, stroke() {}, fill() {}, clip() {}, setLineDash() {},
          drawImage(...args) { if (args.length === 9) drawn.push(args); if (args[0]?.probeTriangle) triangleCopies.push(args); },
          getImageData() { return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }; },
          putImageData() {},
        };
      }
      return this.ctx;
    }
    transferToImageBitmap() { return { close() {} }; }
  }
  function projection() {
    let scale = 350, translate = [500, 300], center = [0, 0];
    const project = point => [translate[0] + point[0] * scale * Math.PI / 180,
      translate[1] - point[1] * scale * Math.PI / 180];
    project.scale = function(value) { if (!arguments.length) return scale; scale = value; return project; };
    project.translate = function(value) { if (!arguments.length) return translate; translate = value; return project; };
    project.center = function(value) { if (!arguments.length) return center; center = value; return project; };
    for (const [field,initial] of Object.entries({rotate:[0,0,0],precision:.1,clipExtent:null,clipAngle:90})) {
      let current=initial;
      project[field]=function(value){if(!arguments.length)return current;current=value;return project;};
    }
    return project;
  }
  const scope = {
    location: { href: 'https://example.test/assets/js/workers/canvas-render-worker.js' },
    d3: { geo: { equirectangular: projection, orthographic: projection, distance: () => 0,
      path: () => {
        const path = geometry => { paths.push(geometry); return path; };
        path.projection = () => path; path.context = () => path; return path;
      } } },
    PandoLabCanvasSceneComposition: {
      drawGeneralLand(_ctx, _path, polygons) { substrates.push(polygons.filter(packet => packet.role === 'physical-land').map(packet => packet.geometry)); },
      drawTerritorialFills() {}, drawOverlays() {}, drawEmphasis() {},
      countryBoundaryBatches: () => [], drawStrokes() {}, geometryFor: packet => packet.geometry,
      generalLandShapes: packets => packets.filter(packet => packet.role === 'physical-land').map(packet => packet.geometry),
    },
    postMessage(message) { messages.push(message); },
  };
  const fetch = (url, options = {}) => url.endsWith('manifest.json')
    ? Promise.resolve({ ok: true, json: async () => manifest })
    : new Promise((resolve, reject) => {
      const request = { url, resolve, completed: false };
      requests.push(request);
      options.signal?.addEventListener('abort', () => {
        request.completed = true;
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    });
  new Function('self', terrainCoreSource)(scope);
  new Function('self', readFileSync(new URL('../../assets/js/workers/resource-update-policy-core.js',import.meta.url),'utf8'))(scope);
  new Function('self', 'importScripts', 'OffscreenCanvas', 'fetch', 'createImageBitmap',
    'ImageData', 'performance', 'setTimeout', workerSource.replace('self.onmessage = event => {',
      'self.drawTerrainTriangle = drawTexturedTriangle; self.onmessage = event => {'))(
    scope, () => {}, Canvas, fetch, async () => ({ width: 3, height: 3, close() {} }),
    class ImageData { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
    { now: () => 1 }, () => 0);
  const country = (id, east = 1) => ({ id, type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [east, 0], [east, 1], [0, 1], [0, 0]]] } });
  const features = [country('VISIBLE'), country('HIDDEN')];
  const land = { key: 'physical-land', role: 'physical-land', geometry: country('LAND', 2).geometry };
  const frame = {
    terrainAllowFallback: true, backgroundPending: false,
    surfacePresentation: { targetQuality: 'canonical', quality: 'canonical' },
    width: 1000, height: 600, dpr: 1, terrainDpr: 2, meshQuality: 'preview',
    renderProjection: { scale: 350, translate: [500, 300] }, projection: 'flat',
    view: { flatCenter: [0, 0], flatZoom: 1 },
    physicalSettings: { terrainVisible: true, terrainStyle: 'political' },
    theme: { baseLandAlpha: 1, defaultLand: '#dddddd', strokes: { country: { width: 1 } } },
    fills: { VISIBLE: { fillAlpha: 1, color: '#ffffff' }, HIDDEN: { fillAlpha: 1, color: '#ffffff' } },
    visible: true, hiddenCountryIds: ['HIDDEN'], scenePolygons: [land], sceneStrokes: [],
    interactionPolygons: [], interactionFillItems: [], countryEmphasis: {},
    visualOrder: { base: ['substrate', 'terrain', 'country-fill'], hydro: [] },
    projectGeneration: 1, geometryRevision: 0, viewRevision: 1, revision: 1,
    styleRevision: 1, physicalStyleRevision: 1,
  };
  const send = message => {
    scope.onmessage({ data: message });
    if(messages.at(-1)?.type==='error')throw new Error(messages.at(-1).message);
  };
  send({ ...frame, type: 'init', features,
    terrainDemManifestUrl: expectDem ? 'https://example.test/expected-dem.json' : undefined,
    terrainManifestUrl: 'https://example.test/assets/data/terrain/v0.12.6/manifest.json' });
  return {
    messages, requests, drawn, paths, substrates, features, land, send, triangleCopies,
    drawTriangle: points => scope.drawTerrainTriangle({ probeTriangle: true }, [[0, 0], [1, 0], [0, 1]], points, 1),
    render: extra => send({ ...frame, ...extra, type: 'view' }),
    levels: () => requests.map(request => Number(request.url.match(/\/(\d+)\/\d+-\d+\.webp$/)?.[1])),
    async deliver(request) {
      assert.ok(request && !request.completed, 'tile request must be pending');
      request.completed = true;
      request.resolve({ ok: true, blob: async () => ({}) });
      await settle();
    },
    find: suffix => requests.find(request => !request.completed && request.url.endsWith(suffix)),
  };
}

test('terrain keeps the physical mask when political objects are hidden or absent at the current time', async () => {
  const h = canvasTerrainRuntime(); await settle();
  const geometry = { type: 'MultiPolygon', coordinates: [[[[0,0],[2,0],[2,2],[0,0]]]] };
  h.paths.length = 0;
  h.render({ visible: false, scenePolygons: [{ key: 'physical-land', role: 'physical-land', geometry }] });
  assert.ok(h.paths.includes(geometry), 'terrain clipping must use the independent physical mask');
});

test('Canvas terrain skips wholly offscreen triangles while keeping crossing and antialiased edge triangles', async () => {
  const h = canvasTerrainRuntime(); await settle(); h.render();
  h.drawTriangle([[-20, -20], [-10, -20], [-20, -10]]);
  h.drawTriangle([[1010, 100], [1020, 100], [1010, 110]]);
  h.drawTriangle([[100, 610], [110, 610], [100, 620]]);
  assert.equal(h.triangleCopies.length, 0, 'offscreen tiles must not submit image copies');
  h.drawTriangle([[2, 2], [10, 2], [2, 10]]);
  h.drawTriangle([[-100, 300], [1100, 300], [500, -100]]);
  h.drawTriangle([[-.5, 0], [-.2, 10], [-.5, 20]]);
  assert.equal(h.triangleCopies.length, 3, 'viewport crossings and the existing 0.75px clip overlap remain visible');
});

test('Canvas terrain demand ignores country preview and backing DPR, but follows source DPR', async () => {
  const h = canvasTerrainRuntime(); await settle(); h.render();
  assert.deepEqual(h.levels(), [2, 2], 'current visible detail consumes both initial fetch slots');
  assert.equal(h.messages.at(-1).terrainStats.terrainReady, false);
  for (let round=0; round<30 && !h.messages.filter(message=>message.type==='frame').at(-1).terrainStats.terrainReady; round++) {
    const request=h.requests.find(request=>!request.completed); if(!request)break;
    await h.deliver(request);h.render();
  }
  h.render({ meshQuality: 'canonical', dpr: 1.5 });
  assert.ok(h.levels().every(level => level === 0 || level === 2));
  h.render({ meshQuality: 'preview', terrainDpr: 1 });
  await settle();
  assert.ok(h.levels().includes(1), 'a lower source DPR selects a lower terrain level');
});

test('Canvas terrain acknowledges prepared coverage and its source limit in the actual frame', async () => {
  const h = canvasTerrainRuntime(); await settle();
  const view = { presentationKey: 'current-view', terrainDpr: 1, renderProjection: { scale: 100, translate: [500, 300] } };
  h.render(view);
  const pending = [...h.requests];
  for (const request of pending) await h.deliver(request);
  h.render(view);
  const message = h.messages.at(-1);
  assert.equal(message.presentationKey, 'current-view');
  assert.equal(message.terrainStats.terrainReady, true);
  assert.equal(message.terrainStats.terrainResolutionLimited, false);
  h.render({ ...view, renderProjection: { scale: 2000, translate: [500, 300] } });
  assert.equal(h.messages.at(-1).terrainStats.terrainResolutionLimited, true);
  assert.equal(h.messages.at(-1).terrainStats.terrainReady, false);
});

test('Canvas cannot acknowledge raster coverage while requested DEM and tint are pending', async () => {
  const h = canvasTerrainRuntime({ expectDem: true }); await settle();
  h.render({ terrainDpr: 1, renderProjection: { scale: 100, translate: [500, 300] } });
  for (const request of h.requests.filter(request => /\/0\//.test(request.url))) await h.deliver(request);
  h.render({ terrainDpr: 1, renderProjection: { scale: 100, translate: [500, 300] } });
  assert.equal(h.messages.at(-1).terrainStats.terrainReady, false);
});

test('Canvas keeps world coverage and the physical mask independently of political geometry and visibility', async () => {
  const h = canvasTerrainRuntime(); await settle(); h.render({terrainDpr:1,renderProjection:{scale:100,translate:[500,300]}});
  assert.equal(h.drawn.length, 0);
  await h.deliver(h.find('/0/0-0.webp'));
  h.render({backgroundPending:true,terrainDpr:1,renderProjection:{scale:100,translate:[500,300]}}); assert.equal(h.drawn.length, 0, 'do not expose a half-loaded world base');
  await h.deliver(h.find('/0/1-0.webp'));
  h.drawn.length = 0; h.substrates.length = 0;
  h.render();
  assert.equal(h.drawn.length, 6, 'two world tiles form a complete flat projection reserve');
  assert.equal(h.messages.at(-1).terrainComplete, false, 'detail is still progressive');
  assert.ok(h.paths.includes(h.land.geometry));
  assert.deepEqual(h.substrates.at(-1), [h.land.geometry]);
  const modified = structuredClone(h.features[0]);
  modified.geometry.coordinates[0][1][0] = 3;
  h.send({ type: 'replace-data', features: [modified, h.features[1]],
    geometryRevision: 1, projectGeneration: 1 });
  h.paths.length = 0; h.drawn.length = 0; h.render();
  assert.deepEqual(h.substrates.at(-1), [h.land.geometry], 'the independent mask survives a political geometry revision');
  assert.equal(h.drawn.length, 0, 'country edits reuse the prepared physical background');
  h.paths.length = 0; h.render({ visible: false });
  assert.deepEqual(h.paths, []);
  assert.deepEqual(h.substrates.at(-1), [h.land.geometry], 'physical land remains when every political object is hidden');
  const detail = h.requests.find(request => !request.completed && /\/2\//.test(request.url));
  assert.ok(detail);
  await h.deliver(detail);
  h.drawn.length = 0; h.render();
  assert.equal(h.drawn.length, 9, 'ready detail tiles overlay the retained two-tile world base');
});

test('Canvas reuses physical terrain through political changes and invalidates it for camera, physical mask and tile changes', async () => {
  const h=canvasTerrainRuntime();await settle();h.render({terrainDpr:1,renderProjection:{scale:100,translate:[500,300]}});
  await h.deliver(h.find('/0/0-0.webp'));await h.deliver(h.find('/0/1-0.webp'));h.render();
  h.drawn.length=0;
  h.render({fills:{VISIBLE:{fillAlpha:0,color:''}}});
  assert.equal(h.drawn.length,0,'changing object color must not reproject terrain tiles');
  h.render({view:{flatCenter:[1,0],flatZoom:1},renderProjection:{scale:350,translate:[490,300]}});
  assert.equal(h.drawn.length,6,'camera changes redraw the terrain');
  h.drawn.length=0;h.render({visible:false});
  assert.equal(h.drawn.length,6,'visibility changes redraw the land mask');
  h.drawn.length=0;h.render({visible:false,darkTheme:true});
  assert.equal(h.drawn.length,6,'theme changes redraw the terrain');
  const detail=h.requests.find(request=>!request.completed && /\/2\//.test(request.url));await h.deliver(detail);
  h.drawn.length=0;h.render({visible:false,darkTheme:true});
  assert.equal(h.drawn.length,9,'arriving detailed terrain must replace the cached preview');
  const child = { role:'territorial-fill', geometry:structuredClone(h.features[0].geometry), style:{fillAlpha:0} };
  h.render();h.drawn.length=0;h.render({scenePolygons:[h.land,child]});
  assert.equal(h.drawn.length,0,'new political land does not invalidate the physical mask');
  h.drawn.length=0;h.render({scenePolygons:[h.land,{...child,style:{fillAlpha:.68}}]});
  assert.equal(h.drawn.length,0,'child paint does not own terrain geometry');
  h.render({scenePolygons:[h.land,{...child,geometry:structuredClone(child.geometry)}]});
  assert.equal(h.drawn.length,0,'replacement political geometry does not invalidate the physical mask');
  h.render({scenePolygons:[{...h.land,geometry:structuredClone(h.land.geometry)}]});
  assert.equal(h.drawn.length,9,'replacement physical source invalidates the mask');
});

test('Canvas neighbour prefetch does not redraw the ready viewport terrain', async () => {
  const h=canvasTerrainRuntime();await settle();h.render({terrainDpr:1,renderProjection:{scale:100,translate:[500,300]}});
  await h.deliver(h.find('/0/0-0.webp'));await h.deliver(h.find('/0/1-0.webp'));h.render();
  for(let count=0;!h.find('/2/0-0.webp') && count<30;count++) {
    const pending=h.requests.find(request=>!request.completed);
    assert.ok(pending);await h.deliver(pending);h.render();
  }
  const neighbour=h.find('/2/0-0.webp');assert.ok(neighbour);
  await h.deliver(neighbour);h.drawn.length=0;h.render();
  assert.equal(h.drawn.length,0,'offscreen prefetch must not trigger a full terrain repaint');
});
