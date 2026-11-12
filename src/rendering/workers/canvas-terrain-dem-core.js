'use strict';
// Canonical numeric DEM palette/shade contract shared by Canvas and WebGL.
// The physical-land mask selects land/ocean presentation; DEM elevation sign never selects it.
(typeof self === 'undefined' ? globalThis : self).PandoLabCanvasTerrainDem = (() => {
  // Retain the legacy brightness adjustment exclusively for the political/monochrome plane.
  const darkBrightness = 0.84;
  const flatShade = 0.27 + 0.73 * Math.SQRT1_2;
  // Monochrome relief contrast is independent of colored land/ocean palette and hillshade data.
  const mono = Object.freeze({ low: 0.48, altitude: 0.34, illumination: 0.60, min: 0.12, max: 0.98 });
  const heightStops = Object.freeze([0, 256, 750, 1500, 2500, 3500, 4500, 6500]);
  const rgb = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const palettes = Object.freeze({
    light: {
      land: ['#70CFA3', '#9BDE91', '#C3DF8C', '#E6D89A', '#F1C6A1', '#DEB09C', '#C5A9A3', '#F4F1EB'].map(rgb),
      seaSurface: rgb('#A5D7F1'), seaDeep: rgb('#6A9FCA'),
    },
    dark: {
      land: ['#477B60', '#629260', '#87A76B', '#ABA476', '#C0AA86', '#AF9486', '#9F8C8A', '#CEC9C3'].map(rgb),
      seaSurface: rgb('#477E99'), seaDeep: rgb('#1F425F'),
    },
  });
  // Shape-preserving cubic tangents are computed once per palette, not per texel.
  function paletteTangents(colors) {
    return colors.map((_, index) => [0, 1, 2].map(channel => {
      const last = heightStops.length - 1;
      const slope = i => (colors[i + 1][channel] - colors[i][channel]) / (heightStops[i + 1] - heightStops[i]);
      if (index === 0 || index === last) {
        const edge = index === 0 ? 0 : last - 1, next = index === 0 ? 1 : last - 2;
        const h0 = heightStops[edge + 1] - heightStops[edge], h1 = heightStops[next + 1] - heightStops[next];
        const d0 = slope(edge), d1 = slope(next), value = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
        if (Math.sign(value) !== Math.sign(d0)) return 0;
        return Math.sign(d0) !== Math.sign(d1) && Math.abs(value) > 3 * Math.abs(d0) ? 3 * d0 : value;
      }
      const d0 = slope(index - 1), d1 = slope(index);
      if (!d0 || !d1 || Math.sign(d0) !== Math.sign(d1)) return 0;
      const h0 = heightStops[index] - heightStops[index - 1], h1 = heightStops[index + 1] - heightStops[index];
      const a = 2 * h1 + h0, b = h1 + 2 * h0;
      return (a + b) / (a / d0 + b / d1);
    }));
  }
  const landTangents = Object.freeze(Object.fromEntries(Object.entries(palettes).map(([theme, value]) => [theme, paletteTangents(value.land)])));
  function landColor(height, colors, tangents, band, channel) {
    const width = heightStops[band + 1] - heightStops[band];
    const t = clamp((height - heightStops[band]) / width, 0, 1), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * colors[band][channel] + (t3 - 2 * t2 + t) * width * tangents[band][channel]
      + (-2 * t3 + 3 * t2) * colors[band + 1][channel] + (t3 - t2) * width * tangents[band + 1][channel];
  }
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
  function sampleInterpolated({dem, width, height, x, y, theme = 'light', channel = 'land'}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || dem?.length !== width * height * 4
      || !Number.isFinite(x) || !Number.isFinite(y) || !palettes[theme] || !['land', 'ocean', 'political'].includes(channel))
      throw new TypeError('Invalid numerical DEM sample.');
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    let elevation = 0, shadeByte = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const px = clamp(x0 + dx, 0, width - 1), py = clamp(y0 + dy, 0, height - 1), at = (py * width + px) * 4;
      const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      let value = dem[at] * 256 + dem[at + 1] - 12000;
      if (channel === 'land') value = Math.max(0, value);
      if (channel === 'ocean') value = Math.min(0, value);
      elevation += value * weight; shadeByte += dem[at + 2] * weight;
    }
    const illumination = Math.max(0, (shadeByte / 255 - 0.42) / 0.58);
    if (channel === 'political') {
      const gray = byte(clamp(mono.low + mono.altitude * smoothHeight(Math.max(0, elevation), 0, 6000)
        + mono.illumination * (illumination - Math.SQRT1_2), mono.min, mono.max));
      return [gray, gray, gray, 255];
    }
    const factor = clamp(reliefShade(illumination) / flatShade, 0.38, 1.3), colors = palettes[theme];
    if (channel === 'ocean') {
      const depth = Math.pow(clamp(-elevation / 8000, 0, 1), 0.6);
      return [0,1,2].map(i => byte((colors.seaSurface[i] * (1 - depth) + colors.seaDeep[i] * depth) * factor)).concat(255);
    }
    let band = 0; while (band < heightStops.length - 2 && elevation >= heightStops[band + 1]) band++;
    return [0,1,2].map(i => byte(landColor(elevation, colors.land, landTangents[theme], band, i) * factor)).concat(255);
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
      const illumination = Math.max(0, (dem[offset + 2] / 255 - 0.42) / 0.58);
      const shade = reliefShade(illumination);
      const factor = clamp(shade / flatShade, 0.38, 1.3);
      const depth = Math.pow(clamp(-heightMeters / 8000, 0, 1), 0.6);
      let band = 0;
      while (band < heightStops.length - 2 && height >= heightStops[band + 1]) band++;
      const gray = political ? byte(clamp(mono.low + mono.altitude * smoothHeight(height, 0, 6000)
        + mono.illumination * (illumination - Math.SQRT1_2), mono.min, mono.max)) : 0;
      for (let channel = 0; channel < 3; channel++) {
        land[offset + channel] = byte(landColor(height, colors.land, landTangents[theme], band, channel) * factor);
        ocean[offset + channel] = byte((colors.seaSurface[channel] * (1 - depth)
          + colors.seaDeep[channel] * depth) * factor);
        if (political) political[offset + channel] = gray;
      }
      land[offset + 3] = ocean[offset + 3] = 255;
      if (political) political[offset + 3] = 255;
    }
    return { land, ocean, political };
  }
  // The GLSL consumes uniforms from the same RGB stops as the Canvas conversion.
  // Theme changes update uniforms, not the DEM texture or a second shader program.
  function colorGlsl() {
    const color = index => `uTerrainLandColors[${index}]`;
    const slope = index => `((${color(index + 1)}-${color(index)})/${(heightStops[index + 1] - heightStops[index]).toFixed(1)})`;
    const tangent = index => {
      const last = heightStops.length - 1;
      if (index === 0 || index === last) {
        const edge = index === 0 ? 0 : last - 1, next = index === 0 ? 1 : last - 2;
        return `pchipEndpoint(${slope(edge)},${slope(next)},${(heightStops[edge + 1] - heightStops[edge]).toFixed(1)},${(heightStops[next + 1] - heightStops[next]).toFixed(1)})`;
      }
      return `pchipInterior(${slope(index - 1)},${slope(index)},${(heightStops[index] - heightStops[index - 1]).toFixed(1)},${(heightStops[index + 1] - heightStops[index]).toFixed(1)})`;
    };
    const parts = [
      'uniform vec3 uTerrainLandColors[8];',
      'uniform vec3 uTerrainSeaSurface;',
      'uniform vec3 uTerrainSeaDeep;',
      'float pchipInterior1(float a,float b,float h0,float h1){ if(a==0.0||b==0.0||sign(a)!=sign(b))return 0.0; float w0=2.0*h1+h0,w1=h1+2.0*h0; return (w0+w1)/(w0/a+w1/b); }',
      'vec3 pchipInterior(vec3 a,vec3 b,float h0,float h1){return vec3(pchipInterior1(a.r,b.r,h0,h1),pchipInterior1(a.g,b.g,h0,h1),pchipInterior1(a.b,b.b,h0,h1));}',
      'float pchipEndpoint1(float a,float b,float h0,float h1){ float v=((2.0*h0+h1)*a-h0*b)/(h0+h1); if(sign(v)!=sign(a))return 0.0; if(sign(a)!=sign(b)&&abs(v)>3.0*abs(a))return 3.0*a; return v; }',
      'vec3 pchipEndpoint(vec3 a,vec3 b,float h0,float h1){return vec3(pchipEndpoint1(a.r,b.r,h0,h1),pchipEndpoint1(a.g,b.g,h0,h1),pchipEndpoint1(a.b,b.b,h0,h1));}',
      'vec3 pchipSegment(vec3 a,vec3 b,vec3 m0,vec3 m1,float t,float h){float t2=t*t,t3=t2*t;return (2.0*t3-3.0*t2+1.0)*a+(t3-2.0*t2+t)*h*m0+(-2.0*t3+3.0*t2)*b+(t3-t2)*h*m1;}',
      'vec3 numericalTerrainColor(float heightMeters, float storedShade, float landPass, float physicalStyle) {',
      '  float height = max(0.0, heightMeters);',
      '  float flatShade = 0.27 + 0.73 * 0.70710678;',
      '  float illumination = max(0.0, (storedShade - 0.42) / 0.58);',
      '  float shade = clamp(flatShade + ((0.27 + 0.73 * illumination) - flatShade) * 1.3, 0.16, 1.0);',
      '  float factor = clamp(shade / flatShade, 0.38, 1.3);',
      `  if (physicalStyle < 0.5) return vec3(clamp(${mono.low.toFixed(2)} + ${mono.altitude.toFixed(2)} * smoothstep(0.0, 6000.0, height)`,
      `    + ${mono.illumination.toFixed(2)} * (illumination - 0.70710678), ${mono.min.toFixed(2)}, ${mono.max.toFixed(2)}));`,
      '  float depth = pow(clamp(-heightMeters / 8000.0, 0.0, 1.0), 0.6);',
      '  if (landPass < 0.5) return mix(uTerrainSeaSurface, uTerrainSeaDeep, depth) * factor;',
    ];
    for (let i = 0; i < heightStops.length - 1; i++) {
      const width = (heightStops[i + 1] - heightStops[i]).toFixed(1);
      parts.push(`  if (height < ${heightStops[i + 1].toFixed(1)}) return pchipSegment(${color(i)},${color(i + 1)},${tangent(i)},${tangent(i + 1)},(height-${heightStops[i].toFixed(1)})/${width},${width}) * factor;`);
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
  return Object.freeze({ convertTile, sampleInterpolated, affineTransform, flatTileRectangle, triangleClip,
    convertedBytesPerPixel, colorGlsl, darkBrightness, paletteForTheme });
})();
