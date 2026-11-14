import { GPU_SPHERICAL_POSITION_GLSL } from "./gpu-shader-utils.js";

// Screen-space analytic distance; source HydroRIVERS coordinates are not modified.
// The JS equivalent is retained for deterministic width, cap and join tests.
export function hydroSegmentSignedDistance(point, start, end, startRadius, endRadius) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 1e-6
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared)) : 0;
  return Math.hypot(point[0] - start[0] - dx * t, point[1] - start[1] - dy * t)
    - (startRadius + (endRadius - startRadius) * t);
}

export function hydroSegmentCoverage(distance, radius) {
  if (!(radius > 0)) return distance <= 0 ? 1 : 0;
  const x = Math.max(0, Math.min(1, (distance + radius) / (2 * radius)));
  return 1 - x * x * (3 - 2 * x);
}

export function hydroSdfShaderSources(version) {
  if (true && false) throw new RangeError('Hydro shader requires WebGL 1 or 2');
  const modern = true;
  const header = `${('#version 300 es\n')}precision highp float; precision highp int;`;
  const vertexAttributes = (`
    layout(location=0) in vec2 aCorner;
    layout(location=1) in ivec2 aStart;
    layout(location=2) in ivec2 aEnd;
    layout(location=3) in uint aCountry;
    layout(location=4) in float aStartWidth;
    layout(location=5) in float aEndWidth;
    out float vDepth; flat out uint vCountry;
    out vec2 vScreenPoint; out vec2 vStartScreen; out vec2 vEndScreen;
    out float vStartRadius; out float vEndRadius;`);
  const fragmentAttributes = (`
    in float vDepth; flat in uint vCountry;
    in vec2 vScreenPoint; in vec2 vStartScreen; in vec2 vEndScreen;
    in float vStartRadius; in float vEndRadius;
    out vec4 outColor;`);
  const vertex = `${header}
    ${GPU_SPHERICAL_POSITION_GLSL}
    ${vertexAttributes}
    uniform vec2 uViewport; uniform vec2 uTranslate; uniform float uScale;
    uniform vec3 uRowX; uniform vec3 uRowY; uniform vec3 uRowZ;
    uniform vec2 uFlatCenter; uniform float uWorldOffset;
    uniform float uWidthBoost; uniform float uWidthScale; uniform float uAaRadius;
    uniform int uMode;
    void projectCoord(vec2 coord, out vec2 screenPoint, out float depth) {
      float lon = coord.x * 0.000001 * 0.017453292519943295;
      float lat = coord.y * 0.000001 * 0.017453292519943295;
      if (uMode == 0) {
        vec3 point = gpuUnitSphere(lon, lat);
        screenPoint = uTranslate + uScale * vec2(dot(uRowX, point), dot(uRowY, point));
        depth = dot(uRowZ, point);
      } else {
        screenPoint = uTranslate + uScale * vec2(lon + uWorldOffset - uFlatCenter.x, -(lat - uFlatCenter.y));
        depth = 1.0;
      }
    }
    void main() {
      vec2 startPoint; vec2 endPoint; float startDepth; float endDepth;
      projectCoord(${('vec2(aStart)')}, startPoint, startDepth);
      projectCoord(${('vec2(aEnd)')}, endPoint, endDepth);
      vec2 span = endPoint - startPoint;
      float lengthPx = length(span);
      vec2 along = lengthPx > 0.0001 ? span / lengthPx : vec2(1.0, 0.0);
      vec2 normal = vec2(-along.y, along.x);
      float startRadius = max(0.0, aStartWidth * uWidthScale + uWidthBoost) * 0.5;
      float endRadius = max(0.0, aEndWidth * uWidthScale + uWidthBoost) * 0.5;
      float envelope = max(startRadius, endRadius) + max(uAaRadius, 0.0);
      vec2 screenPoint = mix(startPoint, endPoint, aCorner.x)
        + along * mix(-envelope, envelope, aCorner.x) + normal * aCorner.y * envelope;
      vStartScreen = startPoint; vEndScreen = endPoint; vScreenPoint = screenPoint;
      vStartRadius = startRadius; vEndRadius = endRadius;
      vDepth = mix(startDepth, endDepth, aCorner.x);
      vCountry = aCountry;
      vec2 clip = vec2(screenPoint.x * 2.0 / uViewport.x - 1.0, 1.0 - screenPoint.y * 2.0 / uViewport.y);
      gl_Position = vec4(clip, 0.0, 1.0);
    }`;
  const sizeType = ('ivec2');
  const visibility = (`int featureId = int(vCountry);
       ivec2 cell = ivec2(featureId % uHydroVisibilitySize.x, featureId / uHydroVisibilitySize.x);
       if (texelFetch(uHydroVisibility, cell, 0).a <= 0.0) discard;`);
  const distance = `
    float hydroSignedDistance() {
      vec2 span = vEndScreen - vStartScreen;
      float lengthSquared = dot(span, span);
      float t = lengthSquared > 0.000001
        ? clamp(dot(vScreenPoint - vStartScreen, span) / lengthSquared, 0.0, 1.0) : 0.0;
      float width = mix(vStartRadius, vEndRadius, t);
      return length(vScreenPoint - (vStartScreen + t * span)) - width;
    }
    float hydroCoverage(float signedDistance, float aa) {
      if (aa <= 0.0) return signedDistance <= 0.0 ? 1.0 : 0.0;
      return 1.0 - smoothstep(-aa, aa, signedDistance);
    }`;
  const fragmentCommon = `${header}
    ${fragmentAttributes}
    uniform sampler2D uHydroVisibility; uniform ${sizeType} uHydroVisibilitySize;
    uniform int uMode;
    ${distance}`;
  const fragment = `${fragmentCommon}
    uniform vec4 uHydroColor;
    uniform bool uCoverageOnly;
    uniform float uAaRadius;
    void main() {
      if (uMode == 0 && vDepth < 0.0) discard;
      ${visibility}
      float coverage = hydroCoverage(hydroSignedDistance(), uAaRadius);
      if (coverage <= 0.001) discard;
      ${('outColor')} = uCoverageOnly
        ? vec4(coverage) : vec4(uHydroColor.rgb, uHydroColor.a * coverage);
    }`;
  const pick = `${fragmentCommon}
    void main() {
      if (uMode == 0 && vDepth < 0.0) discard;
      ${visibility}
      if (hydroSignedDistance() > 0.0) discard;
      ${('uint id = vCountry + 1u; outColor = vec4(float(id & 255u), float((id >> 8u) & 255u), float((id >> 16u) & 255u), 255.0) / 255.0;')}
    }`;
  return Object.freeze({ vertex, fragment, pick });
}
