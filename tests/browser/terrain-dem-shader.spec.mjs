import { expect, test } from '@playwright/test';
import { terrainDemFragmentSource } from '../../assets/js/modules/terrain-dem-shaders.js';

test.use({
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] },
  trace: 'off',
});

for (const version of [2, 1]) test(`DEM fragment compiles and switches B/height shade in WebGL${version}`, async ({ page }) => {
  await page.goto('about:blank');
  const result = await page.evaluate(({ fragment, version }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 4;
    const gl = canvas.getContext(version === 2 ? 'webgl2' : 'webgl', { preserveDrawingBuffer: true });
    if (!gl) return { unavailable: true };
    const vertex = version === 2 ? `#version 300 es
      in vec2 aPosition; out vec2 vUv; out vec2 vLonLat; out float vDepth;
      void main() { gl_Position = vec4(aPosition, 0.0, 1.0); vUv = (aPosition + 1.0) * 0.5;
        vLonLat = vec2(vUv.x * 360.0 - 180.0, 90.0 - vUv.y * 180.0); vDepth = 1.0; }`
      : `attribute vec2 aPosition; varying vec2 vUv; varying vec2 vLonLat; varying float vDepth;
      void main() { gl_Position = vec4(aPosition, 0.0, 1.0); vUv = (aPosition + 1.0) * 0.5;
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
    const tinted = sample(1);
    return { quick, detailed, tinted };
  }, { fragment: terrainDemFragmentSource(version), version });
  if (result.unavailable) test.skip(true, `WebGL${version} unavailable`);
  expect(result.quick[0]).toBeGreaterThanOrEqual(127);
  expect(result.quick[0]).toBeLessThanOrEqual(129);
  expect(result.detailed[0]).toBeGreaterThan(result.quick[0] + 50);
  expect(result.tinted[0]).toBeGreaterThan(result.tinted[1]);
  expect(result.tinted[1]).toBeGreaterThan(result.tinted[2]);
});
