import './workers/canvas-terrain-dem-core.js';

export function terrainDemFragmentSource(glVersion) {
  const webGl2 = glVersion === 2, sample = webGl2 ? 'texture' : 'texture2D';
  const source = `
    precision highp float;
    precision ${webGl2 ? 'highp' : 'mediump'} int;
    ${webGl2 ? 'in' : 'varying'} vec2 vUv;
    ${webGl2 ? 'in' : 'varying'} float vDepth;
    uniform sampler2D uTerrain;
    uniform vec2 uTextureSize;
    uniform int uMode;
    uniform float uPhysicalStyle;
    uniform float uLandPass;
    uniform float uDarkTheme;
    ${webGl2 ? 'out vec4 outColor;' : ''}
    ${globalThis.PandoLabCanvasTerrainDem.colorGlsl()}
    float elevation(vec4 encoded) {
      return floor(encoded.r * 255.0 + 0.5) * 256.0 + floor(encoded.g * 255.0 + 0.5) - 12000.0;
    }
    vec3 demColor(vec2 pixel) {
      vec4 encoded = ${sample}(uTerrain, (pixel + vec2(0.5)) / uTextureSize);
      vec3 color = numericalTerrainColor(elevation(encoded), encoded.b, uLandPass, uPhysicalStyle);
      // Canvas stores each numerical color plane as RGBA8 before sampling.
      return floor(clamp(color, 0.0, 1.0) * 255.0 + 0.5) / 255.0;
    }
    void main() {
      if (uMode == 0 && vDepth < 0.0) discard;
      // Apply the numeric palette per texel, then interpolate the same RGBA8
      // colors as Canvas. Packed elevation bytes never enter interpolation.
      vec2 point = vUv * uTextureSize - vec2(0.5), cell = floor(point), part = fract(point);
      vec3 color = mix(mix(demColor(cell), demColor(cell + vec2(1.0, 0.0)), part.x),
        mix(demColor(cell + vec2(0.0, 1.0)), demColor(cell + vec2(1.0, 1.0)), part.x), part.y);
      // The legacy monochrome/political presentation keeps its existing dark adjustment.
      if (uPhysicalStyle < 0.5) color *= mix(1.0, ${globalThis.PandoLabCanvasTerrainDem.darkBrightness.toFixed(8)}, uDarkTheme);
      ${webGl2 ? 'outColor' : 'gl_FragColor'} = vec4(color, 1.0);
    }
  `;
  return webGl2 ? '#version 300 es\n' + source : source;
}
