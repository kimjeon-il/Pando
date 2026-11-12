// Experiment-only fragment for the existing Viewer terrain draw path.
// The production shader and normal Viewer entrypoints are unchanged.
import '../../src/rendering/workers/canvas-terrain-dem-core.js';
import {HEIGHT_STOPS} from './quality.mjs';

const n=value=>Number(value).toFixed(1);
const color=index=>`uTerrainLandColors[${index}]`;
const delta=index=>`((${color(index+1)}-${color(index)})/${n(HEIGHT_STOPS[index+1]-HEIGHT_STOPS[index])})`;
function tangent(index){
  const last=HEIGHT_STOPS.length-1;
  if(index===0)return `pchipEndpoint(${delta(0)},${delta(1)},${n(HEIGHT_STOPS[1]-HEIGHT_STOPS[0])},${n(HEIGHT_STOPS[2]-HEIGHT_STOPS[1])})`;
  if(index===last)return `pchipEndpoint(${delta(last-1)},${delta(last-2)},${n(HEIGHT_STOPS[last]-HEIGHT_STOPS[last-1])},${n(HEIGHT_STOPS[last-1]-HEIGHT_STOPS[last-2])})`;
  return `pchipInterior(${delta(index-1)},${delta(index)},${n(HEIGHT_STOPS[index]-HEIGHT_STOPS[index-1])},${n(HEIGHT_STOPS[index+1]-HEIGHT_STOPS[index])})`;
}

function pchipGlsl(){
  const segments=HEIGHT_STOPS.slice(1).map((high,i)=>{
    const low=HEIGHT_STOPS[i],width=high-low;
    return `if (height < ${n(high)}) return pchipSegment(${color(i)},${color(i+1)},${tangent(i)},${tangent(i+1)},(height-${n(low)})/${n(width)},${n(width)});`;
  }).join('\n');
  return `
    float pchipInterior1(float d0,float d1,float h0,float h1){
      if(d0==0.0||d1==0.0||sign(d0)!=sign(d1))return 0.0;
      float a=2.0*h1+h0,b=h1+2.0*h0;return (a+b)/(a/d0+b/d1);
    }
    vec3 pchipInterior(vec3 d0,vec3 d1,float h0,float h1){return vec3(
      pchipInterior1(d0.r,d1.r,h0,h1),pchipInterior1(d0.g,d1.g,h0,h1),pchipInterior1(d0.b,d1.b,h0,h1));}
    float pchipEndpoint1(float d0,float d1,float h0,float h1){
      float v=((2.0*h0+h1)*d0-h0*d1)/(h0+h1);
      if(sign(v)!=sign(d0))return 0.0;
      if(sign(d0)!=sign(d1)&&abs(v)>3.0*abs(d0))return 3.0*d0;
      return v;
    }
    vec3 pchipEndpoint(vec3 d0,vec3 d1,float h0,float h1){return vec3(
      pchipEndpoint1(d0.r,d1.r,h0,h1),pchipEndpoint1(d0.g,d1.g,h0,h1),pchipEndpoint1(d0.b,d1.b,h0,h1));}
    vec3 pchipSegment(vec3 y0,vec3 y1,vec3 m0,vec3 m1,float t,float h){
      float t2=t*t,t3=t2*t;
      return (2.0*t3-3.0*t2+1.0)*y0+(t3-2.0*t2+t)*h*m0+(-2.0*t3+3.0*t2)*y1+(t3-t2)*h*m1;
    }
    vec3 pchipLand(float height){if(height<=0.0)return ${color(0)};${segments}return ${color(7)};}
  `;
}

export function experimentColorGlsl(){
  const source=globalThis.PandoLabCanvasTerrainDem.colorGlsl(),marker='vec3 numericalTerrainColor(';
  const at=source.indexOf(marker),land=source.indexOf('  if (height < 256.0)',at),end=source.indexOf('  return uTerrainLandColors[7] * factor;',land);
  if(at<0||land<0||end<0)throw Error('Production terrain color contract changed');
  const tail=end+'  return uTerrainLandColors[7] * factor;'.length;
  return source.slice(0,at)+pchipGlsl()+source.slice(at,land)+'  return pchipLand(height) * factor;'+source.slice(tail);
}

export function a1TerrainFragmentSource(version){
  if(version!==1&&version!==2)throw new TypeError('WebGL version must be 1 or 2');
  const gl2=version===2,sample=gl2?'texture':'texture2D';
  return `${gl2?'#version 300 es\n':''}
    precision highp float;precision ${gl2?'highp':'mediump'} int;
    ${gl2?'in':'varying'} vec2 vUv;${gl2?'in':'varying'} float vDepth;
    uniform sampler2D uTerrain;uniform vec2 uTextureSize;uniform int uMode;
    uniform float uPhysicalStyle;uniform float uLandPass;uniform float uDarkTheme;
    ${gl2?'out vec4 outColor;':''}
    ${experimentColorGlsl()}
    vec2 demValue(vec2 pixel){
      vec4 encoded=${sample}(uTerrain,(pixel+vec2(0.5))/uTextureSize);
      float height=floor(encoded.r*255.0+0.5)*256.0+floor(encoded.g*255.0+0.5)-12000.0;
      // The existing physical-land pass owns classification. Clamp each
      // sample for that pass before interpolation so opposite-side heights
      // do not pull a coastal land/sea color across the mask.
      if(uPhysicalStyle>0.5)height=uLandPass>0.5?max(height,0.0):min(height,0.0);
      return vec2(height,encoded.b);
    }
    void main(){
      if(uMode==0&&vDepth<0.0)discard;
      vec2 p=vUv*uTextureSize-vec2(0.5),cell=floor(p),part=fract(p);
      vec2 values=mix(mix(demValue(cell),demValue(cell+vec2(1.0,0.0)),part.x),
        mix(demValue(cell+vec2(0.0,1.0)),demValue(cell+vec2(1.0,1.0)),part.x),part.y);
      vec3 result=numericalTerrainColor(values.x,values.y,uLandPass,uPhysicalStyle);
      if(uPhysicalStyle<0.5)result*=mix(1.0,${globalThis.PandoLabCanvasTerrainDem.darkBrightness.toFixed(8)},uDarkTheme);
      ${gl2?'outColor':'gl_FragColor'}=vec4(result,1.0);
    }`;
}
