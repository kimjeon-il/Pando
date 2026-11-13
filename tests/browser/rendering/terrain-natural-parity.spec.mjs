import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {terrainDemFragmentSource} from '../../../src/rendering/terrain-dem-shaders.js';
const core=readFileSync(new URL('../../../src/rendering/workers/canvas-terrain-dem-core.js',import.meta.url),'utf8');
const fragment=terrainDemFragmentSource(2);
test.use({launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}});

test('actual WebGL natural interpolation matches numerical Canvas on valid, water and black-sentinel texels',async({page},info)=>{
  await page.goto('/');
  await page.addScriptTag({content:core});
  const result=await page.evaluate(({fragment})=>{
    const lib=globalThis.PandoLabCanvasTerrainDem,canvas=document.createElement('canvas');
    canvas.width=canvas.height=1;
    const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});
    if(!gl)throw Error('Actual WebGL2 context unavailable');
    const shader=(kind,text)=>{const s=gl.createShader(kind);gl.shaderSource(s,text);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    const vertex=shader(gl.VERTEX_SHADER,'#version 300 es\nprecision highp float;uniform vec2 uSampleUv;out vec2 vUv;out float vDepth;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=uSampleUv;vDepth=1.0;gl_Position=vec4(p*2.0-1.0,0,1);}');
    const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);gl.disable(gl.DITHER);gl.disable(gl.BLEND);gl.viewport(0,0,1,1);
    const uniform=name=>gl.getUniformLocation(program,name);
    const upload=(unit,bytes)=>{const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,2,2,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return texture;};
    const dem=new Uint8Array([0,750,2500,6500].flatMap(h=>[(h+12000)>>8,(h+12000)&255,212,255]));
    upload(0,dem);gl.uniform1i(uniform('uTerrain'),0);gl.uniform1i(uniform('uNaturalSurface'),1);
    gl.uniform2f(uniform('uTextureSize'),2,2);gl.uniform1i(uniform('uMode'),1);
    gl.uniform1f(uniform('uPhysicalStyle'),1);gl.uniform1f(uniform('uLandPass'),1);gl.uniform1f(uniform('uNaturalWeight'),0.65);
    gl.uniform4f(uniform('uNaturalFadeEdges'),0,0,0,0);
    const cases={mixed:[100,150,80,255,0,0,0,255,10,60,160,255,235,243,247,255],
      allValid:[100,150,80,255,170,185,100,255,200,180,150,255,235,243,247,255],allInvalid:new Array(16).fill(0)};
    const rows=[];
    for(const [name,values] of Object.entries(cases))for(const theme of ['light','dark']){
      const natural=new Uint8Array(values),texture=upload(1,natural),palette=lib.paletteForTheme(theme);
      gl.uniform3fv(uniform('uTerrainLandColors[0]'),palette.landColors);
      gl.uniform3fv(uniform('uTerrainSeaSurface'),palette.seaSurface);gl.uniform3fv(uniform('uTerrainSeaDeep'),palette.seaDeep);
      gl.uniform1f(uniform('uDarkTheme'),theme==='dark'?1:0);
      for(const [x,y] of [[0,0],[1,1],[0.25,0.75],[0.5,0.5],[0.95,0.1],[-0.4,0.8],[1.3,1.1]]){
        gl.uniform2f(uniform('uSampleUv'),(x+0.5)/2,(y+0.5)/2);gl.drawArrays(gl.TRIANGLES,0,3);
        const actual=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,actual);
        const expected=lib.sampleInterpolated({dem,width:2,height:2,x,y,theme,naturalSurface:{data:natural,width:2,height:2,mixWeight:.65}});
        rows.push({name,theme,x,y,actual:[...actual],expected,max:Math.max(...expected.slice(0,3).map((v,i)=>Math.abs(v-actual[i])))});
      }
      gl.deleteTexture(texture);
    }
    // Test real shader-side boundary feather independently of interior parity.
    const natural=upload(1,new Uint8Array(cases.allValid));
    const palette=lib.paletteForTheme('light');
    gl.uniform3fv(uniform('uTerrainLandColors[0]'),palette.landColors);
    gl.uniform3fv(uniform('uTerrainSeaSurface'),palette.seaSurface);
    gl.uniform3fv(uniform('uTerrainSeaDeep'),palette.seaDeep);
    gl.uniform1f(uniform('uDarkTheme'),0);
    gl.uniform2f(uniform('uSampleUv'),0.5,0.5);
    const draw=edges=>{
      gl.uniform4f(uniform('uNaturalFadeEdges'),...edges);
      gl.drawArrays(gl.TRIANGLES,0,3);
      const bytes=new Uint8Array(4);
      gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
      return [...bytes];
    };
    const interior=draw([0,0,0,0]),feathered=draw([1,1,1,1]);
    gl.deleteTexture(natural);
    const featherDifference=Math.max(...interior.slice(0,3).map((v,i)=>Math.abs(v-feathered[i])));
    const error=gl.getError();return {rows,error,max:Math.max(...rows.map(r=>r.max)),
      interior,feathered,featherDifference};
  },{fragment});
  await info.attach('natural-gpu-cpu-parity',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  expect(result.error).toBe(0);
  expect(result.max,JSON.stringify(result.rows.filter(row=>row.max>1))).toBeLessThanOrEqual(1);
  expect(result.featherDifference,'missing neighbour must feather back to DEM palette').toBeGreaterThan(3);
});


test('ocean/monochrome reference path matches numerical Canvas for both themes and mixed-signed heights',async({page},info)=>{
  await page.goto('/');
  await page.addScriptTag({content:core});
  const outcome=await page.evaluate(({fragment})=>{
    const lib=globalThis.PandoLabCanvasTerrainDem;
    const surface=document.createElement('canvas');
    surface.width=surface.height=1;
    const gl=surface.getContext('webgl2',{preserveDrawingBuffer:true,antialias:false});
    if(!gl)throw Error('WebGL2 unavailable');
    const compile=(type,source)=>{
      const shader=gl.createShader(type);
      gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const vertex=compile(gl.VERTEX_SHADER,
      '#version 300 es\\nprecision highp float;uniform vec2 uSampleUv;out vec2 vUv;out float vDepth;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=uSampleUv;vDepth=1.0;gl_Position=vec4(p*2.0-1.0,0.0,1.0);}');
    const fragmentShader=compile(gl.FRAGMENT_SHADER,fragment),program=gl.createProgram();
    gl.attachShader(program,vertex);gl.attachShader(program,fragmentShader);
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);gl.disable(gl.DITHER);gl.disable(gl.BLEND);gl.viewport(0,0,1,1);
    const u=name=>gl.getUniformLocation(program,name);
    const heights=[-6400,-50,350,5123],shades=[180,206,80,230];
    const dem=new Uint8Array(heights.flatMap((height,index)=>{
      const encoded=height+12000;
      return [encoded>>8,encoded&255,shades[index],255];
    }));
    const tex=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);
    for(const key of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,key,gl.NEAREST);
    for(const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,key,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,2,2,0,gl.RGBA,gl.UNSIGNED_BYTE,dem);
    gl.uniform1i(u('uTerrain'),0);gl.uniform1i(u('uNaturalSurface'),0);
    gl.uniform2f(u('uTextureSize'),2,2);gl.uniform1i(u('uMode'),1);
    gl.uniform1f(u('uNaturalWeight'),0);gl.uniform4f(u('uNaturalFadeEdges'),0,0,0,0);
    const positions=[[0,0],[1,1],[0.27,0.64],[0.5,0.5],[-0.25,0.8],[1.2,0.4]];
    const measurements=[];
    for(const channel of ['ocean','political','land'])for(const theme of ['light','dark']){
      const palette=lib.paletteForTheme(theme);
      gl.uniform3fv(u('uTerrainLandColors[0]'),palette.landColors);
      gl.uniform3fv(u('uTerrainSeaSurface'),palette.seaSurface);
      gl.uniform3fv(u('uTerrainSeaDeep'),palette.seaDeep);
      gl.uniform1f(u('uDarkTheme'),theme==='dark'?1:0);
      gl.uniform1f(u('uPhysicalStyle'),channel==='political'?0:1);
      gl.uniform1f(u('uLandPass'),channel==='ocean'?0:1);
      for(const [x,y] of positions){
        gl.uniform2f(u('uSampleUv'),(x+0.5)/2,(y+0.5)/2);
        gl.drawArrays(gl.TRIANGLES,0,3);
        const actual=new Uint8Array(4);
        gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,actual);
        const base=lib.sampleInterpolated({dem,width:2,height:2,x,y,theme,channel});
        const expected=channel==='political'&&theme==='dark'
          ? base.slice(0,3).map(x=>Math.round(x*lib.darkBrightness))
          : base.slice(0,3);
        measurements.push({channel,theme,x,y,actual:[...actual],
          expected,max:Math.max(...expected.map((b,j)=>Math.abs(actual[j]-b)))});
      }
    }
    const error=gl.getError();
    gl.deleteTexture(tex);gl.deleteShader(vertex);gl.deleteShader(fragmentShader);gl.deleteProgram(program);
    return {measurements,max:Math.max(...measurements.map(x=>x.max)),error};
  },{fragment});
  await info.attach('canvas-webgl-ocean-mono-parity',{body:JSON.stringify(outcome,null,2),contentType:'application/json'});
  expect(outcome.error).toBe(0);
  expect(outcome.max,JSON.stringify(outcome.measurements.filter(x=>x.max>3))).toBeLessThanOrEqual(3);
});
