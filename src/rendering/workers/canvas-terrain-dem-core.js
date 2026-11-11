'use strict';
// Canonical numeric DEM palette/shade contract shared by Canvas and WebGL.
// The physical-land mask selects land/ocean presentation; DEM elevation sign never selects it.
(typeof self === 'undefined' ? globalThis : self).PandoLabCanvasTerrainDem = (() => {
  // Retain the legacy brightness adjustment exclusively for the political/monochrome plane.
  const darkBrightness = 0.84;
  const flatShade = 0.27 + 0.73 * Math.SQRT1_2;
  const heightStops = Object.freeze([0, 256, 750, 1500, 2500, 3500, 4500, 6500]);
  const rgb = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const palettes = Object.freeze({
    light: {
      land: ['#7BBE9D', '#9CD59D', '#B5E197', '#D7D19D', '#EACFAB', '#D6BAA1', '#C4B1A4', '#F2F0EA'].map(rgb),
      seaSurface: rgb('#A5D7F1'), seaDeep: rgb('#6A9FCA'),
    },
    dark: {
      land: ['#477B60', '#629260', '#87A76B', '#ABA476', '#C0AA86', '#AF9486', '#9F8C8A', '#CEC9C3'].map(rgb),
      seaSurface: rgb('#477E99'), seaDeep: rgb('#1F425F'),
    },
  });
  const paletteUniforms = Object.freeze(Object.fromEntries(Object.entries(palettes).map(([theme, value]) => [
    theme, {
      landColors: Float32Array.from(value.land.flat()),
      seaSurface: Float32Array.from(value.seaSurface),
      seaDeep: Float32Array.from(value.seaDeep),
    },
  ])));
  const paletteForTheme = theme => {
    if (theme !== 'light' && theme !== 'dark') throw new TypeError('Unknown DEM terrain theme.');
    return paletteUniforms[theme];
  };
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  // Three prepared RGBA planes (land, ocean, political), excluding the retained source DEM.
  const convertedBytesPerPixel = 12;
  const byte = value => Math.round(clamp(value, 0, 1) * 255);
  function smoothHeight(height, low, high) {
    const t = clamp((height - low) / (high - low), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function reliefShade(illumination) {
    return clamp(flatShade + ((0.27 + 0.73 * illumination) - flatShade) * 1.3, 0.16, 1);
  }
  function convertTile({ dem, width, height, theme = 'light', includePolitical = true }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || dem?.length !== width * height * 4) throw new TypeError('Invalid numerical DEM tile.');
    if (theme !== 'light' && theme !== 'dark') throw new TypeError('Unknown DEM terrain theme.');
    const colors = palettes[theme];
    const land = new Uint8ClampedArray(dem.length), ocean = new Uint8ClampedArray(dem.length);
    const political = includePolitical ? new Uint8ClampedArray(dem.length) : null;
    for (let offset = 0; offset < dem.length; offset += 4) {
      const heightMeters = dem[offset] * 256 + dem[offset + 1] - 12000;
      const height = Math.max(0, heightMeters);
      const shade = reliefShade(Math.max(0, (dem[offset + 2] / 255 - 0.42) / 0.58));
      const factor = clamp(shade / flatShade, 0.38, 1.3);
      const depth = Math.pow(clamp(-heightMeters / 8000, 0, 1), 0.6);
      let band = 0;
      while (band < heightStops.length - 2 && height >= heightStops[band + 1]) band++;
      const t = smoothHeight(height, heightStops[band], heightStops[band + 1]);
      for (let channel = 0; channel < 3; channel++) {
        land[offset + channel] = byte((colors.land[band][channel] * (1 - t)
          + colors.land[band + 1][channel] * t) * factor);
        ocean[offset + channel] = byte((colors.seaSurface[channel] * (1 - depth)
          + colors.seaDeep[channel] * depth) * factor);
        if (political) political[offset + channel] = byte((0.58 + 0.3 * smoothHeight(height, 0, 6000)) * factor);
      }
      land[offset + 3] = ocean[offset + 3] = 255;
      if (political) political[offset + 3] = 255;
    }
    return { land, ocean, political };
  }
  // The GLSL consumes uniforms from the same RGB stops as the Canvas conversion.
  // Theme changes update uniforms, not the DEM texture or a second shader program.
  function colorGlsl() {
    const parts = [
      'uniform vec3 uTerrainLandColors[8];',
      'uniform vec3 uTerrainSeaSurface;',
      'uniform vec3 uTerrainSeaDeep;',
      'vec3 numericalTerrainColor(float heightMeters, float storedShade, float landPass, float physicalStyle) {',
      '  float height = max(0.0, heightMeters);',
      '  float flatShade = 0.27 + 0.73 * 0.70710678;',
      '  float illumination = max(0.0, (storedShade - 0.42) / 0.58);',
      '  float shade = clamp(flatShade + ((0.27 + 0.73 * illumination) - flatShade) * 1.3, 0.16, 1.0);',
      '  float factor = clamp(shade / flatShade, 0.38, 1.3);',
      '  if (physicalStyle < 0.5) return vec3((0.58 + 0.3 * smoothstep(0.0, 6000.0, height)) * factor);',
      '  float depth = pow(clamp(-heightMeters / 8000.0, 0.0, 1.0), 0.6);',
      '  if (landPass < 0.5) return mix(uTerrainSeaSurface, uTerrainSeaDeep, depth) * factor;',
    ];
    for (let i = 0; i < heightStops.length - 1; i++) {
      parts.push('  if (height < ' + heightStops[i + 1].toFixed(1) + ') return mix(uTerrainLandColors[' + i
        + '], uTerrainLandColors[' + (i + 1) + '], smoothstep(' + heightStops[i].toFixed(1)
        + ', ' + heightStops[i + 1].toFixed(1) + ', height)) * factor;');
    }
    parts.push('  return uTerrainLandColors[7] * factor;', '}');
    return parts.join('\n');
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
    convertedBytesPerPixel, colorGlsl, darkBrightness, paletteForTheme });
})();
