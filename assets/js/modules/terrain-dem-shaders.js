const common = (sample) => `
  float elevation(vec4 encoded) {
    return floor(encoded.r * 255.0 + 0.5) * 256.0 + floor(encoded.g * 255.0 + 0.5) - 12000.0;
  }
  vec4 demSample(vec2 pixel) {
    return ${sample}(uTerrain, (pixel + vec2(0.5)) / uTextureSize);
  }
  float derivedShade(vec2 uv) {
    vec2 point = uv * uTextureSize - vec2(0.5);
    vec2 cell = floor(point);
    vec2 fraction = fract(point);
    float h00 = elevation(demSample(cell));
    float h10 = elevation(demSample(cell + vec2(1.0, 0.0)));
    float h01 = elevation(demSample(cell + vec2(0.0, 1.0)));
    float h11 = elevation(demSample(cell + vec2(1.0, 1.0)));
    float eastMeters = 40030228.884 * max(0.0001, cos(radians(vLonLat.y))) / uLevelSize.x;
    float northMeters = 20015114.442 / uLevelSize.y;
    float riseEast = mix(h10 - h00, h11 - h01, fraction.y) / eastMeters;
    float riseNorth = -mix(h01 - h00, h11 - h10, fraction.x) / northMeters;
    vec3 normal = normalize(vec3(-riseEast, -riseNorth, 1.0));
    vec3 light = vec3(-0.5, 0.5, 0.70710678);
    return 0.42 + 0.58 * max(0.0, dot(normal, light));
  }
  vec3 seaColor(float heightMeters) {
    float depth = pow(clamp(-heightMeters / 8000.0, 0.0, 1.0), 0.6);
    return mix(vec3(0.42, 0.66, 0.82), vec3(0.10, 0.24, 0.39), depth);
  }
  vec3 terrainColor() {
    vec4 packed = ${sample}(uTerrain, vUv);
    float heightMeters = elevation(packed);
    float shade = packed.b;
    if (uShadeBlend > 0.001 && abs(vLonLat.y) < 89.5) {
      shade = mix(shade, derivedShade(vUv), uShadeBlend);
    }
    if (uPhysicalStyle < 0.5) return vec3(shade);
    vec3 baseColor = uLandPass > 0.5
      ? ${sample}(uTint, vec2((vLonLat.x + 180.0) / 360.0, (90.0 - vLonLat.y) / 180.0)).rgb
      : seaColor(heightMeters);
    return baseColor * mix(0.72, 1.12, shade);
  }
`;

export function terrainDemFragmentSource(glVersion) {
  const webGl2 = glVersion === 2;
  // The tint sampler is referenced explicitly below; height data always comes
  // from uTerrain. At texel centers RGBA is exact even with LINEAR filtering.
  const source = `
    precision highp float;
    ${webGl2 ? 'in' : 'varying'} vec2 vUv;
    ${webGl2 ? 'in' : 'varying'} vec2 vLonLat;
    ${webGl2 ? 'in' : 'varying'} float vDepth;
    uniform sampler2D uTerrain;
    uniform sampler2D uTint;
    uniform vec2 uTextureSize;
    uniform vec2 uLevelSize;
    uniform int uMode;
    uniform float uPhysicalStyle;
    uniform float uLandPass;
    uniform float uShadeBlend;
    uniform float uDarkTheme;
    ${webGl2 ? 'out vec4 outColor;' : ''}
    ${common(webGl2 ? 'texture' : 'texture2D')}
    void main() {
      if (uMode == 0 && vDepth < 0.0) discard;
      vec3 color = terrainColor();
      color = mix(color, color * vec3(0.60, 0.68, 0.76), uDarkTheme * 0.48);
      ${webGl2 ? 'outColor' : 'gl_FragColor'} = vec4(color, 1.0);
    }
  `;
  return webGl2 ? `#version 300 es\n${source}` : source;
}
