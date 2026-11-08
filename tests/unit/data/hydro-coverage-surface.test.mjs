import { describe as contractSuite } from 'node:test';
import * as __hydro_dep0 from "node:test";
import * as __hydro_dep1 from "node:assert/strict";
import * as __hydro_dep2 from "../../../src/rendering/gpu-hydro-coverage.js";
import * as __hydro_dep3 from "node:fs";
import * as __hydro_dep4 from "../../../src/data/hydro-tile-window.js";
import * as __hydro_dep5 from "../../../src/data/physical-resources.js";
contractSuite("hydro-coverage-surface", () => {
const test = __hydro_dep0.default;
const assert = __hydro_dep1.default;
const { createGpuHydroCoverage } = __hydro_dep2;




function fakeGl(supportMax = true) {
  const constants = ['MAX','ARRAY_BUFFER','TEXTURE_2D','TEXTURE3','ACTIVE_TEXTURE','TEXTURE_BINDING_2D',
    'FRAMEBUFFER','READ_FRAMEBUFFER','FRAMEBUFFER_BINDING','READ_FRAMEBUFFER_BINDING',
    'VIEWPORT','CURRENT_PROGRAM','ARRAY_BUFFER_BINDING','COLOR_CLEAR_VALUE','COLOR_WRITEMASK',
    'BLEND','STENCIL_TEST','SCISSOR_TEST','DEPTH_TEST','CULL_FACE','BLEND_EQUATION_RGB',
    'BLEND_EQUATION_ALPHA','BLEND_SRC_RGB','BLEND_DST_RGB','BLEND_SRC_ALPHA','BLEND_DST_ALPHA',
    'NEAREST','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T',
    'CLAMP_TO_EDGE','RGBA','UNSIGNED_BYTE','COLOR_ATTACHMENT0','FRAMEBUFFER_COMPLETE','STATIC_DRAW',
    'COLOR_BUFFER_BIT','ONE','SRC_ALPHA','ONE_MINUS_SRC_ALPHA','FUNC_ADD','TRIANGLE_STRIP','FLOAT',
    'VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS']
    .reduce((obj,key,index)=>(obj[key]=index+1,obj),{});
  const gl = {...constants};
  let activeTexture = gl.TEXTURE3, framebuffer = null, readFramebuffer = null, program = null, arrayBuffer = null;
  let viewport = [0,0,128,128], clear = [0,0,0,0], colorMask = [true,true,true,true];
  let equation = gl.FUNC_ADD, factors=[gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA];
  const enabled = new Set([gl.BLEND]);
  const bindings = new Map();
  const calls = [];
  gl.calls = calls;
  gl.isContextLost = () => false;
  gl.createShader = () => ({});
  gl.shaderSource = gl.compileShader = gl.deleteShader = gl.attachShader = gl.linkProgram = () => {};
  gl.getShaderParameter = gl.getProgramParameter = () => true;
  gl.getShaderInfoLog = gl.getProgramInfoLog = () => '';
  gl.createProgram = () => ({});
  gl.getExtension = name => supportMax && name === 'EXT_blend_minmax' ? {MAX_EXT:gl.MAX}:null;
  gl.createTexture = () => ({});
  gl.createFramebuffer = () => ({});
  gl.createBuffer = () => ({});
  gl.deleteTexture = gl.deleteFramebuffer = gl.deleteBuffer = gl.deleteProgram = () => {};
  gl.getAttribLocation = () => 0;
  gl.getUniformLocation = () => ({});
  gl.getParameter = name => {
    if (name===gl.ACTIVE_TEXTURE) return activeTexture;
    if (name===gl.TEXTURE_BINDING_2D) return bindings.get(activeTexture)||null;
    if (name===gl.FRAMEBUFFER_BINDING) return framebuffer;
    if (name===gl.READ_FRAMEBUFFER_BINDING) return readFramebuffer;
    if (name===gl.VIEWPORT) return viewport;
    if (name===gl.CURRENT_PROGRAM) return program;
    if (name===gl.ARRAY_BUFFER_BINDING) return arrayBuffer;
    if (name===gl.COLOR_CLEAR_VALUE) return clear;
    if (name===gl.COLOR_WRITEMASK) return colorMask;
    if (name===gl.BLEND_EQUATION_RGB||name===gl.BLEND_EQUATION_ALPHA)return equation;
    if (name===gl.BLEND_SRC_RGB) return factors[0];
    if (name===gl.BLEND_DST_RGB) return factors[1];
    if (name===gl.BLEND_SRC_ALPHA) return factors[2];
    if (name===gl.BLEND_DST_ALPHA) return factors[3];
    return null;
  };
  gl.isEnabled = name => enabled.has(name);
  gl.enable = name => enabled.add(name);
  gl.disable = name => enabled.delete(name);
  gl.activeTexture = value => activeTexture=value;
  gl.bindTexture = (_,texture) => bindings.set(activeTexture,texture);
  gl.bindFramebuffer = (target,value) => {if(target===gl.READ_FRAMEBUFFER)readFramebuffer=value;else {framebuffer=value;readFramebuffer=value;}};
  gl.viewport = (...args) => viewport=args;
  gl.useProgram = value => program=value;
  gl.bindBuffer = (_,value) => arrayBuffer=value;
  gl.clearColor = (...args) => clear=args;
  gl.colorMask = (...args) => colorMask=args;
  gl.blendEquation = value => {equation=value;calls.push(['equation',value]);};
  gl.blendEquationSeparate = (rgb) => equation=rgb;
  gl.blendFunc = (...args) => {factors=[args[0],args[1],args[0],args[1]];};
  gl.blendFuncSeparate = (...args) => factors=args;
  gl.texImage2D = gl.texParameteri = gl.framebufferTexture2D = gl.bufferData =
    gl.clear = gl.uniform1i = gl.uniform4fv = gl.enableVertexAttribArray =
    gl.vertexAttribPointer = gl.disableVertexAttribArray = ()=>{};
  gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_COMPLETE;
  gl.drawArrays = (...args) => calls.push(['draw',...args]);
  return gl;
}

test('coverage surface uses MAX union and restores the previous scene framebuffer', () => {
  const gl=fakeGl();
  const coverage=createGpuHydroCoverage();
  coverage.setContext(gl,2);
  let count=0;
  assert.equal(coverage.render({width:128,height:128,color:[0.1,0.3,0.7,0.6],paint(){count++;}}),true);
  assert.equal(coverage.render({width:128,height:128,color:[0.1,0.3,0.7,0.6],paint(){count++;}}),true);
  assert.equal(count,2);
  assert.equal(coverage.stats().renderCount,2);
  assert.equal(coverage.stats().bufferBytes,128*128*4);
  assert.equal(gl.getParameter(gl.FRAMEBUFFER_BINDING),null);
  assert.equal(gl.getParameter(gl.BLEND_EQUATION_RGB),gl.FUNC_ADD);
  assert.ok(gl.calls.some(call=>call[0]==='equation'&&call[1]===gl.MAX));
  assert.equal(gl.calls.filter(call=>call[0]==='draw').length,2);
  coverage.dispose();
  assert.equal(coverage.stats().bufferBytes,0);
});

test('unavailable WebGL1 MAX blending and budget overflow return to direct SDF', () => {
  const gl=fakeGl(false), coverage=createGpuHydroCoverage({maxBytes:16});
  coverage.setContext(gl,1);
  let painted=false;
  assert.equal(coverage.render({width:2,height:2,color:[1,1,1,1],paint(){painted=true;}}),false);
  assert.equal(painted,false);
  assert.equal(coverage.stats().fallbackCount,1);
  const gl2=fakeGl();
  coverage.setContext(gl2,2);
  assert.equal(coverage.render({width:3,height:3,color:[1,1,1,1],paint(){painted=true;}}),false);
  assert.equal(painted,false);
  assert.equal(coverage.stats().fallbackCount,2);
});
});
contractSuite("hydro-tile-window", () => {
const assert = __hydro_dep1.default;
const fs = __hydro_dep3.default;
const test = __hydro_dep0.default;
const { createHydroTileWindow, hydroTileSpecsForWindow, hydroViewportSizeClass } = __hydro_dep4;
const { hydroVisibilityThresholdForMapZoom } = __hydro_dep5;






const manifest = Object.freeze({
  stages: Object.freeze([
    Object.freeze({ id: 0, minZoom: 6, columns: 8, rows: 4 }),
    Object.freeze({ id: 1, minZoom: 7, columns: 16, rows: 8 }),
  ]),
});

function flatWindow(overrides = {}) {
  return createHydroTileWindow({
    manifest,
    projection: 'flat',
    threshold: 6.5,
    width: 200,
    height: 160,
    scale: 10_000,
    flatCenter: [10, 20],
    ...overrides,
  });
}

test('published four hydro stages open only at map zoom 3.5, 7, 14, and 28', () => {
  const fourStageManifest = { stages: [
    { id: 0, minZoom: 6.0, columns: 8, rows: 4 },
    { id: 1, minZoom: 6.7, columns: 16, rows: 8 },
    { id: 2, minZoom: 7.0, columns: 32, rows: 16 },
    { id: 3, minZoom: 7.5, columns: 64, rows: 32 },
  ] };
  const cases = [
    [1, []], [3.4999, []],
    [3.5, [0]], [6.9999, [0]],
    [7, [0, 1]], [13.9999, [0, 1]],
    [14, [0, 1, 2]], [27.9999, [0, 1, 2]],
    [28, [0, 1, 2, 3]], [32, [0, 1, 2, 3]], [64, [0, 1, 2, 3]],
  ];
  for (const [zoom, expected] of cases) {
    const window = createHydroTileWindow({
      manifest: fourStageManifest,
      projection: 'flat',
      threshold: hydroVisibilityThresholdForMapZoom(zoom),
      width: 900, height: 700, scale: 1600, flatCenter: [0, 0],
    });
    assert.deepEqual(window.windows.map(stage => stage.stage), expected, `map zoom ${zoom}`);
  }
  assert.equal(hydroVisibilityThresholdForMapZoom(Number.NaN), Number.NEGATIVE_INFINITY);
});

test('hydro tile window ignores raw view revision inside the same quantized window', () => {
  const first = flatWindow({ flatCenter: [10, 20], viewRevision: 1 });
  const second = flatWindow({ flatCenter: [11, 20], viewRevision: 999 });
  assert.equal(second.signature, first.signature);
  assert.deepEqual(hydroTileSpecsForWindow(second), hydroTileSpecsForWindow(first));
});

test('hydro tile window changes only after a geographic tile boundary is crossed', () => {
  const before = flatWindow({ flatCenter: [44, 20] });
  const after = flatWindow({ flatCenter: [50, 20] });
  assert.notEqual(after.signature, before.signature);
  assert.notDeepEqual(hydroTileSpecsForWindow(after), hydroTileSpecsForWindow(before));
});

test('hydro threshold is quantized to the active stage set', () => {
  const withinStage = flatWindow({ threshold: 6.1 });
  const sameStage = flatWindow({ threshold: 6.9 });
  const nextStage = flatWindow({ threshold: 7 });
  assert.equal(sameStage.signature, withinStage.signature);
  assert.notEqual(nextStage.signature, withinStage.signature);
  assert.deepEqual([...new Set(hydroTileSpecsForWindow(nextStage).map(spec => spec.stage))], [0, 1]);
});

test('projection and viewport size class participate in the cache key', () => {
  const flat = flatWindow({ width: 255, height: 200 });
  const resized = flatWindow({ width: 257, height: 200 });
  const globe = createHydroTileWindow({
    manifest,
    projection: 'globe',
    threshold: 6.5,
    width: 255,
    height: 200,
    scale: 10_000,
    rotation: [-10, -20, 0],
  });
  assert.equal(hydroViewportSizeClass(255, 200), '1x1');
  assert.equal(hydroViewportSizeClass(257, 200), '2x1');
  assert.notEqual(resized.signature, flat.signature);
  assert.notEqual(globe.signature, flat.signature);
});

test('date-line equivalent centers share one wrapped tile window', () => {
  const east = flatWindow({ flatCenter: [179, 0] });
  const west = flatWindow({ flatCenter: [-179, 0] });
  assert.equal(west.signature, east.signature);
  assert.deepEqual(hydroTileSpecsForWindow(west), hydroTileSpecsForWindow(east));
});

test('quantized globe windows conservatively retain every legacy visible tile', () => {
  const distance = ([leftLongitude, leftLatitude], [rightLongitude, rightLatitude]) => {
    const radians = Math.PI / 180;
    const leftPhi = leftLatitude * radians;
    const rightPhi = rightLatitude * radians;
    const deltaPhi = (rightLatitude - leftLatitude) * radians;
    const deltaLambda = (rightLongitude - leftLongitude) * radians;
    const haversine = Math.sin(deltaPhi / 2) ** 2
      + Math.cos(leftPhi) * Math.cos(rightPhi) * Math.sin(deltaLambda / 2) ** 2;
    return 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
  };
  for (const rotation of [[0, 0, 0], [-170, -65, 0], [175, 72, 0]]) {
    const width = 900;
    const height = 700;
    const scale = 520;
    const tileWindow = createHydroTileWindow({
      manifest,
      projection: 'globe',
      threshold: 7,
      width,
      height,
      scale,
      rotation,
    });
    const quantizedKeys = new Set(hydroTileSpecsForWindow(tileWindow).map(spec => `${spec.stage}/${spec.x}-${spec.y}`));
    const center = [-rotation[0], -rotation[1]];
    const radius = Math.asin(Math.min(1, Math.hypot(width, height) * 0.5 / scale));
    for (const stage of manifest.stages) {
      const tileLongitude = 360 / stage.columns;
      const tileLatitude = 180 / stage.rows;
      const tileRadius = Math.hypot(tileLongitude, tileLatitude) * Math.PI / 360;
      for (let y = 0; y < stage.rows; y += 1) {
        for (let x = 0; x < stage.columns; x += 1) {
          const tileCenter = [-180 + (x + 0.5) * tileLongitude, 90 - (y + 0.5) * tileLatitude];
          if (distance(center, tileCenter) <= radius + tileRadius + 0.04) {
            assert.ok(quantizedKeys.has(`${stage.id}/${x}-${y}`), `missing conservative tile ${stage.id}/${x}-${y}`);
          }
        }
      }
    }
  }
});

test('gpu hydro request cache no longer includes raw view revision', () => {
  const source = fs.readFileSync(new URL("../../../src/rendering/gpu-hydro-preparation.js", import.meta.url), 'utf8');
  const start = source.indexOf('function requestHydroView');
  const end = source.indexOf('function loadHydroLogicalFeature', start);
  const requestSource = source.slice(start, end);
  assert.ok(requestSource.includes('createHydroTileWindow'));
  assert.doesNotMatch(requestSource, /viewState\?\.revision|currentRenderRevision/);
});

test('hydro tile range enumeration matches exhaustive longitude and latitude scans', () => {
  // Reference is the exhaustive pre-optimization rule, including seam handling,
  // epsilon and ascending tile order; do not relax it to set equality.
  const normalize = value => ((value + 180) % 360 + 360) % 360 - 180;
  const exhaustive = (columns, rows, lon, lat, halfLon, halfLat) => {
    const xIndices = [];
    const dx = 360 / columns, dy = 180 / rows;
    for (let x = 0; x < columns; x++) {
      const tileCenter = -180 + (x + 0.5) * dx;
      if (Math.abs(normalize(tileCenter - normalize(lon))) <= halfLon + dx / 2 + 1e-9)
        xIndices.push(x);
    }
    let yStart = rows, yEnd = -1;
    for (let y = 0; y < rows; y++) {
      const tileCenter = 90 - (y + 0.5) * dy;
      if (Math.abs(tileCenter - Math.max(-90, Math.min(90, lat))) <= halfLat + dy / 2 + 1e-9) {
        yStart = Math.min(yStart, y); yEnd = Math.max(yEnd, y);
      }
    }
    return {xIndices, yStart:yEnd >= yStart ? yStart : 0, yEnd};
  };
  let seed = 0x4b1d;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
  const columnSizes = [1,2,3,8,16,64,512,1024];
  const rowSizes = [1,2,3,8,64,256,512];
  for (let i = 0; i < 2200; i++) {
    const columns = columnSizes[i % columnSizes.length];
    const rows = rowSizes[i % rowSizes.length];
    const lon = i % 7 === 0 ? 180 : i % 11 === 0 ? -180 : random() * 1800 - 900;
    const lat = i % 13 === 0 ? 90 : i % 17 === 0 ? -90 : random() * 200 - 100;
    const width = 1 + random() * 1200, height = 1 + random() * 900, scale = 1 + random() * 25000;
    const halfLon = width / scale * 90 / Math.PI + 2;
    const halfLat = height / scale * 90 / Math.PI + 2;
    const actual = createHydroTileWindow({
      manifest:{stages:[{id:1,minZoom:0,columns,rows}]},
      projection:'flat',threshold:1,width,height,scale,flatCenter:[lon,lat],
    }).windows[0];
    const expected = exhaustive(columns,rows,lon,lat,halfLon,halfLat);
    assert.deepEqual({xIndices:actual.xIndices,yStart:actual.yStart,yEnd:actual.yEnd},
      expected,`tile window ${i}, ${columns}x${rows}`);
  }
});
});
