import { expect, test } from '@playwright/test';
import { terrainDemFragmentSource } from '../../assets/js/modules/terrain-dem-shaders.js';

// Keep CI deterministic, but allow the same pixel regressions on a native GPU.
const angleBackend = process.env.PANDOLAB_TEST_ANGLE_BACKEND || 'swiftshader';

test.use({
  launchOptions: { args: ['--use-gl=angle', `--use-angle=${angleBackend}`, '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] },
  trace: 'off',
});

// Render the production fragment against controlled elevation tiles. Sampling a
// constant UV keeps the assertions independent of camera/projection arithmetic.
async function renderSamples(page, version, tile, samples) {
  await page.goto('about:blank');
  return page.evaluate(({ fragment, version, tile, samples }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const gl = canvas.getContext(version === 2 ? 'webgl2' : 'webgl', { preserveDrawingBuffer: true });
    if (!gl) throw new Error(`WebGL${version} unavailable for DEM regression`);
    const vertex = `${version === 2 ? '#version 300 es\n' : ''}
      precision highp float;
      ${version === 2 ? 'in' : 'attribute'} vec2 aPosition;
      ${version === 2 ? 'out' : 'varying'} vec2 vUv;
      ${version === 2 ? 'out' : 'varying'} vec2 vLonLat;
      ${version === 2 ? 'out' : 'varying'} float vDepth;
      uniform vec2 uSampleUv; uniform vec2 uSampleLonLat;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        vUv = uSampleUv; vLonLat = uSampleLonLat; vDepth = 1.0;
      }`;
    const compile = (kind, source) => {
      const shader = gl.createShader(kind);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const upload = (unit, width, height, pixels) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    };
    const pixels = new Uint8Array(tile.width * tile.height * 4);
    tile.heights.forEach((height, i) => {
      const encoded = Math.round(height) + 12000;
      pixels.set([encoded >> 8, encoded & 255, 128, 255], i * 4);
    });
    upload(0, tile.width, tile.height, pixels);
    upload(1, 1, 1, new Uint8Array([200, 100, 50, 255]));
    const uniform = name => gl.getUniformLocation(program, name);
    gl.uniform1i(uniform('uTerrain'), 0); gl.uniform1i(uniform('uTint'), 1);
    gl.uniform1i(uniform('uMode'), 1);
    gl.uniform2f(uniform('uTextureSize'), tile.width, tile.height);
    // At latitude zero these level dimensions give 100 m per texel.
    gl.uniform2f(uniform('uLevelSize'), 400302.28884, 200151.14442);
    const results = samples.map(sample => {
      gl.uniform2f(uniform('uSampleUv'), (sample.x + 0.5) / tile.width, (sample.y + 0.5) / tile.height);
      gl.uniform2f(uniform('uSampleLonLat'), 0, sample.latitude || 0);
      gl.uniform1f(uniform('uShadeBlend'), sample.blend ?? 1);
      gl.uniform1f(uniform('uPhysicalStyle'), sample.physical ? 1 : 0);
      gl.uniform1f(uniform('uLandPass'), 1);
      gl.uniform1f(uniform('uDarkTheme'), sample.dark ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const rgba = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      return Array.from(rgba);
    });
    if (gl.getError() !== gl.NO_ERROR) throw new Error('DEM sample produced a WebGL error');
    return results;
  }, { fragment: terrainDemFragmentSource(version), version, tile, samples });
}

function elevationTile(width, height, elevationAt) {
  return { width, height, heights: Array.from({ length: width * height },
    (_, index) => elevationAt(index % width, Math.floor(index / width))) };
}

for (const version of [2, 1]) {
  test(`DEM curved slopes remain continuous across cell and half-cell boundaries in WebGL${version}`, async ({ page }) => {
    const tile = elevationTile(7, 7, (x, y) => 40 * x * x + 40 * y * y);
    // A cell-local derivative jumps here even though the height is continuous.
    const samples = [1.5, 2, 2.5, 3].flatMap(boundary => [
      { x: boundary - 0.001, y: 2.25 }, { x: boundary + 0.001, y: 2.25 },
      { x: 2.25, y: boundary - 0.001 }, { x: 2.25, y: boundary + 0.001 },
    ]);
    const colors = await renderSamples(page, version, tile, samples);
    for (let i = 0; i < colors.length; i += 2) {
      expect(Math.abs(colors[i][0] - colors[i + 1][0]), `boundary pair ${i / 2}`).toBeLessThanOrEqual(1);
    }
  });

  test(`DEM flat surfaces preserve shade, tint, dark theme and fast shade in WebGL${version}`, async ({ page }) => {
    const tile = elevationTile(6, 6, () => 0);
    const colors = await renderSamples(page, version, tile, [
      { x: 2.25, y: 2.25 }, { x: 2.25, y: 2.25, physical: true },
      { x: 2.25, y: 2.25, dark: true }, { x: 2.25, y: 2.25, physical: true, dark: true },
      { x: 2.25, y: 2.25, blend: 0 }, { x: 2.25, y: 2.25, blend: 0.5 },
      { x: 2.25, y: 2.25, latitude: 89.6 },
    ]);
    const expected = [[212,212,212,255], [200,100,50,255], [171,179,187,255],
      [162,85,44,255], [128,128,128,255], [170,170,170,255], [128,128,128,255]];
    for (let i = 0; i < colors.length; i += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        expect(Math.abs(colors[i][channel] - expected[i][channel])).toBeLessThanOrEqual(1);
      }
    }
  });

  test(`DEM constant slopes survive RG carry and one-pixel tile gutters in WebGL${version}`, async ({ page }) => {
    // Encoding 0 m as 12000 makes the first 32 m step carry from G into R.
    const samples = [0.5, 1.1, 1.49, 1.51, 2.25, 4.5].map(x => ({ x, y: 2.25 }));
    const east = await renderSamples(page, version, elevationTile(6, 6, x => 32 * x), samples);
    const south = await renderSamples(page, version, elevationTile(6, 6, (x, y) => 32 * y),
      samples.map(({ x, y }) => ({ x: y, y: x })));
    for (const color of [...east, ...south]) expect(Math.abs(color[0] - 229)).toBeLessThanOrEqual(1);
  });

  test(`DEM central differences match curved surface gradients and latitude scale in WebGL${version}`, async ({ page }) => {
    const tile = elevationTile(7, 7, (x, y) => {
      const east = x - 3, south = y - 3;
      return 90 * east * east + 55 * south * south + 35 * east * south;
    });
    // For this quadratic, half-texel differences are exactly
    // dH/dx = 180(x-3) + 35(y-3), dH/dy = 110(y-3) + 35(x-3).
    // Literal shade bytes include the existing light and latitude correction.
    const colors = await renderSamples(page, version, tile, [
      { x: 3.1, y: 3.8 }, { x: 3.7, y: 3.2 }, { x: 2.25, y: 3.75 },
      { x: 3.25, y: 2.75 }, { x: 3.1, y: 3.8, latitude: 45 },
    ]);
    const expected = [251, 244, 149, 216, 254];
    for (let i = 0; i < colors.length; i += 1) expect(Math.abs(colors[i][0] - expected[i])).toBeLessThanOrEqual(1);
  });

  test(`DEM neighboring tiles agree at edges and four-tile corners in WebGL${version}`, async ({ page }) => {
    const height = (x, y) => 25 * x * x + 35 * y * y + 15 * x * y;
    const tile = (originX, originY) => elevationTile(6, 6, (x, y) => height(originX + x - 1, originY + y - 1));
    const topLeft = await renderSamples(page, version, tile(0, 0), [{ x: 4.5, y: 2.25 }, { x: 4.5, y: 4.5 }]);
    const topRight = await renderSamples(page, version, tile(4, 0), [{ x: 0.5, y: 2.25 }, { x: 0.5, y: 4.5 }]);
    const bottomLeft = await renderSamples(page, version, tile(0, 4), [{ x: 4.5, y: 0.5 }]);
    const bottomRight = await renderSamples(page, version, tile(4, 4), [{ x: 0.5, y: 0.5 }]);
    expect(topLeft[0]).toEqual(topRight[0]);
    expect(topLeft[1]).toEqual(topRight[1]);
    expect(topLeft[1]).toEqual(bottomLeft[0]);
    expect(topLeft[1]).toEqual(bottomRight[0]);
  });
}

for (const version of [2, 1]) test(`DEM fragment compiles and switches B/height shade in WebGL${version}`, async ({ page }) => {
  await page.goto('about:blank');
  const result = await page.evaluate(({ fragment, version }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 4;
    const gl = canvas.getContext(version === 2 ? 'webgl2' : 'webgl', { preserveDrawingBuffer: true });
    if (!gl) return { unavailable: true };
    const vertex = version === 2 ? `#version 300 es
      precision highp int;
      in vec2 aPosition; out vec2 vUv; out vec2 vLonLat; out float vDepth; uniform int uMode;
      void main() { gl_Position = vec4(aPosition, 0.0, 1.0); vUv = (aPosition + 1.0) * 0.5;
        if (uMode < 0) gl_Position.x = -gl_Position.x;
        vLonLat = vec2(vUv.x * 360.0 - 180.0, 90.0 - vUv.y * 180.0); vDepth = 1.0; }`
      : `precision mediump int;
        attribute vec2 aPosition; varying vec2 vUv; varying vec2 vLonLat; varying float vDepth; uniform int uMode;
      void main() { gl_Position = vec4(aPosition, 0.0, 1.0); vUv = (aPosition + 1.0) * 0.5;
        if (uMode < 0) gl_Position.x = -gl_Position.x;
        vLonLat = vec2(vUv.x * 360.0 - 180.0, 90.0 - vUv.y * 180.0); vDepth = 1.0; }`;
    const compile = (kind, source) => {
      const shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'aPosition');
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = (unit, width, height, pixels) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      const target = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, target);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    };
    texture(0, 2, 2, new Uint8Array([46,224,128,255, 47,0,128,255, 46,224,128,255, 47,0,128,255]));
    texture(1, 1, 1, new Uint8Array([200,100,50,255]));
    const uniform = (name) => gl.getUniformLocation(program, name);
    gl.uniform1i(uniform('uTerrain'), 0); gl.uniform1i(uniform('uTint'), 1);
    gl.uniform2f(uniform('uTextureSize'), 2, 2); gl.uniform2f(uniform('uLevelSize'), 1350, 675);
    gl.uniform1i(uniform('uMode'), 1); gl.uniform1f(uniform('uDarkTheme'), 0);
    gl.uniform1f(uniform('uLandPass'), 1); gl.uniform1f(uniform('uPhysicalStyle'), 0);
    const sample = blend => {
      gl.uniform1f(uniform('uShadeBlend'), blend);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const pixel = new Uint8Array(4); gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return Array.from(pixel);
    };
    const quick = sample(0), detailed = sample(1);
    gl.uniform1f(uniform('uPhysicalStyle'), 1);
    const tintedQuick = sample(0);
    const tinted = sample(1);
    return { quick, detailed, tintedQuick, tinted };
  }, { fragment: terrainDemFragmentSource(version), version });
  if (result.unavailable) test.skip(true, `WebGL${version} unavailable`);
  expect(result.quick[0]).toBeGreaterThanOrEqual(127);
  expect(result.quick[0]).toBeLessThanOrEqual(129);
  expect(result.detailed[0]).toBeGreaterThan(result.quick[0] + 50);
  expect(result.tintedQuick[0]).toBeGreaterThanOrEqual(118);
  expect(result.tintedQuick[0]).toBeLessThanOrEqual(124);
  expect(result.tinted[0]).toBeGreaterThan(result.tinted[1]);
  expect(result.tinted[1]).toBeGreaterThan(result.tinted[2]);
});
