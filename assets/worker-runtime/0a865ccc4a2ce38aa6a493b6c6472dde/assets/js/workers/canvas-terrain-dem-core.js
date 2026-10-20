'use strict';
// The Canvas worker consumes the same encoded elevation and tint as WebGL.
// This module has no fetch, cache, or document state so pixel conversion can be tested independently.
(typeof self === 'undefined' ? globalThis : self).PandoLabCanvasTerrainDem = (() => {
  const flatShade = 0.42 + 0.58 * Math.SQRT1_2;
  const seaSurface = [0.42, 0.66, 0.82], seaDeep = [0.10, 0.24, 0.39];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const byte = value => Math.round(clamp(value, 0, 1) * 255);
  function sampleTint(data, width, height, longitude, latitude) {
    // WebGL samples tint at normalized lon/lat coordinates with LINEAR filtering.
    const x = clamp((longitude + 180) / 360 * width - 0.5, 0, width - 1);
    const y = clamp((90 - latitude) / 180 * height - 0.5, 0, height - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const at = (column, row, channel) => data[(row * width + column) * 4 + channel] / 255;
    return [0, 1, 2].map(channel => {
      const upper = at(x0, y0, channel) * (1 - fx) + at(x1, y0, channel) * fx;
      const lower = at(x0, y1, channel) * (1 - fx) + at(x1, y1, channel) * fx;
      return upper * (1 - fy) + lower * fy;
    });
  }
  function colorAt(dem, tint, width, height, longitude, latitude) {
    const elevation = dem[0] * 256 + dem[1] - 12000;
    const shade = dem[2] / 255;
    const factor = clamp(shade / flatShade, 0.5, 1.2);
    const depth = Math.pow(clamp(-elevation / 8000, 0, 1), 0.6);
    const ocean = [0.42, 0.66, 0.82].map((upper, index) => upper * (1 - depth) + [0.10, 0.24, 0.39][index] * depth);
    const land = sampleTint(tint, width, height, longitude, latitude);
    return { land: land.map(value => byte(value * factor)), ocean: ocean.map(value => byte(value * factor)), gray: dem[2] };
  }
  function convertTile({ dem, width, height, tint, tintWidth, tintHeight,
    bounds, pixelWidth, pixelHeight, levelWidth, levelHeight }) {
    const land = new Uint8ClampedArray(dem.length), ocean = new Uint8ClampedArray(dem.length), political = new Uint8ClampedArray(dem.length);
    const [west, north, east, south] = bounds;
    const tintColumns = Array.from({ length: width }, (_, column) => {
      let longitude = west + (east - west) * (column - 0.5) / pixelWidth;
      if (longitude < -180 || longitude > 180) longitude = ((longitude + 180) % 360 + 360) % 360 - 180;
      const x = clamp((longitude + 180) / 360 * tintWidth - 0.5, 0, tintWidth - 1);
      return { x0: Math.floor(x), x1: Math.min(tintWidth - 1, Math.floor(x) + 1), fx: x - Math.floor(x) };
    });
    const elevationAt = (column, row) => {
      const offset = (clamp(row, 0, height - 1) * width + clamp(column, 0, width - 1)) * 4;
      return dem[offset] * 256 + dem[offset + 1] - 12000;
    };
    for (let row = 0; row < height; row += 1) {
      const latitude = north + (south - north) * (row - 0.5) / pixelHeight;
      const y = clamp((90 - latitude) / 180 * tintHeight - 0.5, 0, tintHeight - 1);
      const y0 = Math.floor(y), y1 = Math.min(tintHeight - 1, y0 + 1), fy = y - y0;
      const eastMeters = 40030228.884 * Math.max(0.0001, Math.cos(latitude * Math.PI / 180)) / levelWidth;
      const northMeters = 20015114.442 / levelHeight;
      for (let column = 0; column < width; column += 1) {
        const offset = (row * width + column) * 4;
        let shade = dem[offset + 2] / 255;
        if (Math.abs(latitude) < 89.5) {
          // At DEM cell centers the WebGL settled shader's bilinear central
          // difference is exactly (next height - previous height) / 2.
          const riseEast = (elevationAt(column + 1, row) - elevationAt(column - 1, row)) * 0.5 / eastMeters;
          const riseNorth = -(elevationAt(column, row + 1) - elevationAt(column, row - 1)) * 0.5 / northMeters;
          const light = (riseEast * 0.5 - riseNorth * 0.5 + Math.SQRT1_2) / Math.hypot(riseEast, riseNorth, 1);
          shade = 0.42 + 0.58 * Math.max(0, light);
        }
        const factor = clamp(shade / flatShade, 0.5, 1.2);
        const depth = Math.pow(clamp(-elevationAt(column, row) / 8000, 0, 1), 0.6);
        const { x0, x1, fx } = tintColumns[column];
        for (let channel = 0; channel < 3; channel += 1) {
          const upper = tint[(y0 * tintWidth + x0) * 4 + channel] * (1 - fx) + tint[(y0 * tintWidth + x1) * 4 + channel] * fx;
          const lower = tint[(y1 * tintWidth + x0) * 4 + channel] * (1 - fx) + tint[(y1 * tintWidth + x1) * 4 + channel] * fx;
          land[offset + channel] = Math.round(clamp((upper * (1 - fy) + lower * fy) * factor, 0, 255));
          ocean[offset + channel] = byte((seaSurface[channel] * (1 - depth) + seaDeep[channel] * depth) * factor);
          political[offset + channel] = byte(shade);
        }
        land[offset + 3] = ocean[offset + 3] = political[offset + 3] = 255;
      }
    }
    return { land, ocean, political };
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
  return Object.freeze({ colorAt, sampleTint, convertTile, affineTransform, flatTileRectangle, triangleClip });
})();
