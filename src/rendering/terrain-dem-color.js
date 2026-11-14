// Canonical DEM palette and shader color contract, independent of the rendering backend.
const darkBrightness = 0.84;
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
export {darkBrightness,paletteForTheme,colorGlsl};
