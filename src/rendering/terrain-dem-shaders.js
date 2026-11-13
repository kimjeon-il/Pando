import './workers/canvas-terrain-dem-core.js';

export function terrainDemFragmentSource(glVersion) {
  const webGl2 = glVersion === 2, sample = webGl2 ? 'texture' : 'texture2D';
  const source = `
    precision highp float;
    precision ${webGl2 ? 'highp' : 'mediump'} int;
    ${webGl2 ? 'in' : 'varying'} vec2 vUv;
    ${webGl2 ? 'in' : 'varying'} float vDepth;
    uniform sampler2D uTerrain;
    uniform sampler2D uNaturalSurface;
    uniform float uNaturalWeight;
    uniform vec4 uNaturalFadeEdges; // west, east, north, south; 1 only for missing neighbouring data
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
      if(uPhysicalStyle>0.5 && uLandPass>0.5 && uNaturalWeight>0.0){
        // Match numerical Canvas at mixed water/missing cells: classify each
        // source texel before weighting, never interpolate black or blue source
        // water into otherwise valid observed land.
        vec3 surfaceSum=vec3(0.0);
        float surfaceCoverage=0.0;
        for(int oy=0;oy<2;oy++)for(int ox=0;ox<2;ox++){
          vec2 stepOffset=vec2(float(ox),float(oy));
          float w=(ox==0?1.0-part.x:part.x)*(oy==0?1.0-part.y:part.y);
          vec3 candidate=${sample}(uNaturalSurface,(cell+stepOffset+vec2(0.5))/uTextureSize).rgb;
          bool valid=max(candidate.r,max(candidate.g,candidate.b))>0.01
            && !(candidate.b>candidate.r*1.12 && candidate.b>candidate.g*1.05);
          if(valid){surfaceSum+=candidate*w;surfaceCoverage+=w;}
        }
        if(surfaceCoverage>0.0){
          float flatShade=0.27+0.73*0.70710678;
          float illumination=max(0.0,(values.y-0.42)/0.58);
          float shade=clamp(flatShade+((0.27+0.73*illumination)-flatShade)*1.3,0.16,1.0);
          float factor=clamp(shade/flatShade,0.38,1.3);
          vec3 surface=surfaceSum/surfaceCoverage*mix(1.0,0.72,uDarkTheme);
          // One 64-source-pixel feather is used only where the adjacent
          // natural-color tile is absent; neighbouring present tiles never
          // acquire internal seams or additional smoothing.
          vec2 location=clamp(vUv*uTextureSize-vec2(1.0),vec2(0.0),uTextureSize-vec2(2.0));
          vec2 extent=uTextureSize-vec2(2.0);
          float edgeWeight=1.0;
          edgeWeight*=mix(1.0,smoothstep(0.0,64.0,location.x),uNaturalFadeEdges.x);
          edgeWeight*=mix(1.0,smoothstep(0.0,64.0,extent.x-location.x),uNaturalFadeEdges.y);
          edgeWeight*=mix(1.0,smoothstep(0.0,64.0,location.y),uNaturalFadeEdges.z);
          edgeWeight*=mix(1.0,smoothstep(0.0,64.0,extent.y-location.y),uNaturalFadeEdges.w);
          color=mix(color,surface*factor,clamp(uNaturalWeight,0.0,1.0)*surfaceCoverage*edgeWeight);
        }
      }
      // The legacy monochrome/political presentation keeps its existing dark adjustment.
      if (uPhysicalStyle < 0.5) color *= mix(1.0, ${globalThis.PandoLabCanvasTerrainDem.darkBrightness.toFixed(8)}, uDarkTheme);
      ${webGl2 ? 'outColor' : 'gl_FragColor'} = vec4(color, 1.0);
    }
  `;
  return webGl2 ? '#version 300 es\n' + source : source;
}
