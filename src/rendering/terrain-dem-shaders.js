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
    vec2 demValue(vec2 pixel) {
      vec4 encoded = ${sample}(uTerrain, (pixel + vec2(0.5)) / uTextureSize);
      float height = elevation(encoded);
      // Classification stays with the physical-land mask; opposite-side
      // elevation cannot pull a land or sea color across its boundary.
      if (uPhysicalStyle > 0.5) height = uLandPass > 0.5 ? max(height, 0.0) : min(height, 0.0);
      return vec2(height, encoded.b);
    }
    void main() {
      if (uMode == 0 && vDepth < 0.0) discard;
      // Decode each sample first; interpolating packed elevation bytes corrupts heights.
      vec2 point = vUv * uTextureSize - vec2(0.5), cell = floor(point), part = fract(point);
      vec2 values = mix(mix(demValue(cell), demValue(cell + vec2(1.0, 0.0)), part.x),
        mix(demValue(cell + vec2(0.0, 1.0)), demValue(cell + vec2(1.0, 1.0)), part.x), part.y);
      vec3 color = numericalTerrainColor(values.x, values.y, uLandPass, uPhysicalStyle);
      // The legacy monochrome/political presentation keeps its existing dark adjustment.
      if (uPhysicalStyle < 0.5) color *= mix(1.0, ${globalThis.PandoLabCanvasTerrainDem.darkBrightness.toFixed(8)}, uDarkTheme);
      ${webGl2 ? 'outColor' : 'gl_FragColor'} = vec4(color, 1.0);
    }
  `;
  return webGl2 ? '#version 300 es\n' + source : source;
}
