import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workerSource = readFileSync(new URL('../../assets/js/workers/canvas-render-worker.js', import.meta.url), 'utf8');
const manifest = { gutter: 1, urlTemplate: 'terrain/v0.12.6/{level}/{column}-{row}.webp', levels: [
  { id: 0, width: 1350, height: 675, columns: 2, rows: 1, tileSize: 1024 },
  { id: 1, width: 2700, height: 1350, columns: 3, rows: 2, tileSize: 1024 },
  { id: 2, width: 5400, height: 2700, columns: 6, rows: 3, tileSize: 1024 },
] };
const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };

function canvasTerrainRuntime() {
  const messages = [], requests = [], drawn = [], paths = [], substrates = [];
  class Canvas {
    constructor(width, height) { this.width = width; this.height = height; this.ctx = null; }
    getContext() {
      if (!this.ctx) {
        const canvas = this;
        this.ctx = {
          canvas, setTransform() {}, clearRect() {}, save() {}, restore() {}, beginPath() {},
          moveTo() {}, lineTo() {}, arc() {}, closePath() {}, stroke() {}, fill() {}, clip() {}, setLineDash() {},
          drawImage(...args) { if (args.length === 9) drawn.push(args); },
          getImageData() { return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }; },
          putImageData() {},
        };
      }
      return this.ctx;
    }
    transferToImageBitmap() { return { close() {} }; }
  }
  function projection() {
    let scale = 350, translate = [500, 300];
    const project = point => [translate[0] + point[0] * scale * Math.PI / 180,
      translate[1] - point[1] * scale * Math.PI / 180];
    project.scale = function(value) { if (!arguments.length) return scale; scale = value; return project; };
    project.translate = function(value) { if (!arguments.length) return translate; translate = value; return project; };
    for (const field of ['center', 'rotate', 'precision', 'clipExtent', 'clipAngle']) project[field] = () => project;
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
      drawGeneralLand(_ctx, _path, _polygons, features) { substrates.push(features); },
      drawTerritorialFills() {}, drawOverlays() {}, drawEmphasis() {},
      countryBoundaryBatches: () => [], drawStrokes() {}, geometryFor: packet => packet.geometry,
    },
    postMessage(message) { messages.push(message); },
  };
  const fetch = url => url.endsWith('manifest.json')
    ? Promise.resolve({ ok: true, json: async () => manifest })
    : new Promise(resolve => requests.push({ url, resolve, completed: false }));
  new Function('self', 'importScripts', 'OffscreenCanvas', 'fetch', 'createImageBitmap',
    'ImageData', 'performance', 'setTimeout', workerSource)(
    scope, () => {}, Canvas, fetch, async () => ({ width: 3, height: 3, close() {} }),
    class ImageData { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
    { now: () => 1 }, () => 0);
  const country = (id, east = 1) => ({ id, type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [east, 0], [east, 1], [0, 1], [0, 0]]] } });
  const features = [country('VISIBLE'), country('HIDDEN')];
  const frame = {
    width: 1000, height: 600, dpr: 1, terrainDpr: 2, meshQuality: 'preview',
    renderProjection: { scale: 350, translate: [500, 300] }, projection: 'flat',
    view: { flatCenter: [0, 0], flatZoom: 1 },
    physicalSettings: { terrainVisible: true, terrainStyle: 'political' },
    theme: { baseLandAlpha: 1, defaultLand: '#dddddd', strokes: { country: { width: 1 } } },
    fills: { VISIBLE: { fillAlpha: 1, color: '#ffffff' }, HIDDEN: { fillAlpha: 1, color: '#ffffff' } },
    visible: true, hiddenCountryIds: ['HIDDEN'], scenePolygons: [], sceneStrokes: [],
    interactionPolygons: [], interactionFillItems: [], countryEmphasis: {},
    visualOrder: { base: ['substrate', 'terrain', 'country-fill'], hydro: [] },
    projectGeneration: 1, geometryRevision: 0, viewRevision: 1, revision: 1,
    styleRevision: 1, physicalStyleRevision: 1,
  };
  const send = message => scope.onmessage({ data: message });
  send({ ...frame, type: 'init', features,
    terrainManifestUrl: 'https://example.test/assets/data/terrain/v0.12.6/manifest.json' });
  return {
    messages, requests, drawn, paths, substrates, features, send,
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

test('Canvas terrain demand ignores country preview and backing DPR, but follows source DPR', async () => {
  const h = canvasTerrainRuntime(); await settle(); h.render();
  assert.deepEqual(h.levels(), [0, 0], 'world base consumes both initial fetch slots');
  assert.equal(h.messages.at(-1).terrainComplete, false);
  await h.deliver(h.find('/0/0-0.webp'));
  await h.deliver(h.find('/0/1-0.webp'));
  h.render();
  assert.ok(h.levels().includes(2), 'preview countries cannot restrict terrain to low LOD');
  assert.ok(h.levels().every(level => level === 0 || level === 2));
  h.render({ meshQuality: 'canonical', dpr: 1.5 });
  assert.ok(h.levels().every(level => level === 0 || level === 2));
  h.render({ meshQuality: 'preview', terrainDpr: 1 });
  await h.deliver(h.requests.find(request => !request.completed && /\/2\//.test(request.url)));
  assert.ok(h.levels().includes(1), 'a lower source DPR selects a lower terrain level');
});

test('Canvas keeps complete world coverage and masks only accepted visible country geometry', async () => {
  const h = canvasTerrainRuntime(); await settle(); h.render();
  assert.equal(h.drawn.length, 0);
  await h.deliver(h.find('/0/0-0.webp'));
  h.render(); assert.equal(h.drawn.length, 0, 'do not expose a half-loaded world base');
  await h.deliver(h.find('/0/1-0.webp'));
  h.drawn.length = 0; h.paths.length = 0; h.substrates.length = 0;
  h.render();
  assert.equal(h.drawn.length, 6, 'two world tiles form a complete flat projection reserve');
  assert.equal(h.messages.at(-1).terrainComplete, false, 'detail is still progressive');
  const mask = h.paths.find(path => path.type === 'FeatureCollection');
  assert.deepEqual(mask.features.map(feature => feature.id), ['VISIBLE']);
  assert.deepEqual(h.substrates.at(-1).map(feature => feature.id), ['VISIBLE']);
  const modified = structuredClone(h.features[0]);
  modified.geometry.coordinates[0][1][0] = 3;
  h.send({ type: 'replace-data', features: [modified, h.features[1]],
    geometryRevision: 1, projectGeneration: 1 });
  h.paths.length = 0; h.drawn.length = 0; h.render();
  assert.equal(h.paths.find(path => path.type === 'FeatureCollection').features[0]
    .geometry.coordinates[0][1][0], 3, 'the mask follows the adopted geometry revision');
  assert.equal(h.drawn.length, 6, 'country edits do not evict world terrain coverage');
  h.paths.length = 0; h.render({ visible: false });
  assert.deepEqual(h.paths.find(path => path.type === 'FeatureCollection').features, []);
  const detail = h.requests.find(request => !request.completed && /\/2\//.test(request.url));
  assert.ok(detail);
  await h.deliver(detail);
  h.drawn.length = 0; h.render();
  assert.equal(h.drawn.length, 9, 'ready detail tiles overlay the retained two-tile world base');
});
