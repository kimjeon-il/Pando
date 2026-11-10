'use strict';
// Canvas and WebGL consume one numerical elevation/stored-shade color contract.
// This module has no fetch, cache, or document state so pixel conversion can be tested independently.
(typeof self === 'undefined' ? globalThis : self).PandoLabCanvasTerrainDem = (() => {
  const darkBrightness = 0.84;
  const flatShade = 0.27 + 0.73 * Math.SQRT1_2;
  const seaSurface = [0.42, 0.66, 0.82], seaDeep = [0.10, 0.24, 0.39];
  const heightColors = [[0.43,0.62,0.39],[0.68,0.72,0.44],[0.72,0.57,0.39],[0.72,0.68,0.62],[0.96,0.95,0.90]];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  // Three decoded RGBA planes (land, ocean, political), including DEM gutters.
  const convertedBytesPerPixel = 12;
  const byte = value => Math.round(clamp(value, 0, 1) * 255);
  function smoothHeight(height, low, high) {
    const t=clamp((height-low)/(high-low),0,1);
    return t*t*(3-2*t);
  }
  function reliefShade(illumination) {
    return clamp(flatShade+((0.27+0.73*illumination)-flatShade)*1.3,0.16,1);
  }
  function convertTile({ dem, width, height }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || dem?.length !== width * height * 4) throw new TypeError('Invalid numerical DEM tile.');
    const land = new Uint8ClampedArray(dem.length), ocean = new Uint8ClampedArray(dem.length), political = new Uint8ClampedArray(dem.length);
    for (let offset = 0; offset < dem.length; offset += 4) {
      const heightMeters = dem[offset] * 256 + dem[offset + 1] - 12000;
      const height = Math.max(0, heightMeters);
      const shade = reliefShade(Math.max(0, (dem[offset + 2] / 255 - 0.42) / 0.58));
      const factor = clamp(shade / flatShade, 0.38, 1.3);
      const depth = Math.pow(clamp(-heightMeters / 8000, 0, 1), 0.6);
      const h1 = smoothHeight(height, 0, 1000), h2 = smoothHeight(height, 1000, 2500),
        h3 = smoothHeight(height, 2500, 4500), h4 = smoothHeight(height, 4500, 6500);
      for (let channel = 0; channel < 3; channel += 1) {
        let color = heightColors[0][channel] * (1-h1) + heightColors[1][channel] * h1;
        color = color * (1-h2) + heightColors[2][channel] * h2;
        color = color * (1-h3) + heightColors[3][channel] * h3;
        color = color * (1-h4) + heightColors[4][channel] * h4;
        land[offset + channel] = byte(color * factor);
        ocean[offset + channel] = byte((seaSurface[channel] * (1-depth) + seaDeep[channel] * depth) * factor);
        political[offset + channel] = byte((0.58 + 0.3 * smoothHeight(height, 0, 6000)) * factor);
      }
      land[offset+3] = ocean[offset+3] = political[offset+3] = 255;
    }
    return { land, ocean, political };
  }
  // The shader is emitted from the same palette and shade contract. Neither
  // backend infers the land mask from elevation or precolored pixels.
  function colorGlsl() {
    const vec = values => 'vec3(' + values.map(value => Number(value).toFixed(8)).join(',') + ')';
    return `
      vec3 numericalTerrainColor(float heightMeters, float storedShade, float landPass, float physicalStyle) {
        float height = max(0.0, heightMeters);
        float flatShade = 0.27 + 0.73 * 0.70710678;
        float illumination = max(0.0, (storedShade - 0.42) / 0.58);
        float shade = clamp(flatShade + ((0.27 + 0.73 * illumination) - flatShade) * 1.3, 0.16, 1.0);
        float factor = clamp(shade / flatShade, 0.38, 1.3);
        if (physicalStyle < 0.5) return vec3((0.58 + 0.3 * smoothstep(0.0, 6000.0, height)) * factor);
        float depth = pow(clamp(-heightMeters / 8000.0, 0.0, 1.0), 0.6);
        if (landPass < 0.5) return mix(${vec(seaSurface)}, ${vec(seaDeep)}, depth) * factor;
        vec3 color = mix(${vec(heightColors[0])}, ${vec(heightColors[1])}, smoothstep(0.0, 1000.0, height));
        color = mix(color, ${vec(heightColors[2])}, smoothstep(1000.0, 2500.0, height));
        color = mix(color, ${vec(heightColors[3])}, smoothstep(2500.0, 4500.0, height));
        color = mix(color, ${vec(heightColors[4])}, smoothstep(4500.0, 6500.0, height));
        return color * factor;
      }
    `;
  }
  function affineTransform(source, destination) {
    const [s0, s1, s2] = source, [d0, d1, d2] = destination;
    const denominator = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
    if (Math.abs(denominator) < 1e-7) return null;
    const coefficients = values => [
      (values[0] * (s1[1] - s2[1]) + values[1] * (s2[1] - s0[1]) + values[2] * (s0[1] - s1[1])) / denominator,
      (values[0] * (s2[0] - s1[0]) + values[1] * (s0[0] - s2[0]) + values[2] * (s1[0] - s0[0])) / denominator,
      (values[0] * (s1[0] * s2[1] - s2[0] * s1[1]) + values[1] * (s2[0] * s0[1] - s0[0] * s2[1]) + values[2] * (s0[0] * s1[1] - s1[0] * s0[1])) / denominator,
    ];
    const x = coefficients([d0[0], d1[0], d2[0]]), y = coefficients([d0[1], d1[1], d2[1]]);
    return [x[0], y[0], x[1], y[1], x[2], y[2]];
  }
  function flatTileRectangle(bounds, scale, translate, center, offset = 0) {
    const [west, north, east, south] = bounds, radians = Math.PI / 180;
    return [translate[0] + scale * (west + offset - center[0]) * radians,
      translate[1] - scale * (north - center[1]) * radians,
      scale * (east - west) * radians, scale * (north - south) * radians];
  }
  function triangleClip(points, bleed) {
    // Adjacent Canvas clips each antialias their edge. Extend only the screen
    // clip by one physical pixel; the geographic texture transform stays fixed.
    const [a, b, c] = points;
    const sign = Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (!sign) return points;
    const normals = points.map((point, index) => {
      const next = points[(index + 1) % 3], dx = next[0] - point[0], dy = next[1] - point[1], length = Math.hypot(dx, dy);
      return [sign * dy / length, -sign * dx / length];
    });
    return points.map((point, index) => {
      const previous = normals[(index + 2) % 3], next = normals[index];
      const distance = bleed / Math.max(0.05, 1 + previous[0] * next[0] + previous[1] * next[1]);
      return [point[0] + (previous[0] + next[0]) * distance, point[1] + (previous[1] + next[1]) * distance];
    });
  }
  return Object.freeze({ convertTile, affineTransform, flatTileRectangle, triangleClip,
    convertedBytesPerPixel, colorGlsl, darkBrightness });
})();
