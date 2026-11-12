#!/usr/bin/env node
// Isolated globe inverse-projection prototype using the exact A1 1024 WebP tiles.
import {chromium} from '@playwright/test';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {experimentColorGlsl} from './a1-shader.mjs';

const [fixtureDir,maskDir,outArg]=process.argv.slice(2);
if(!fixtureDir||!maskDir||!outArg)throw Error('Expected WebP fixture directory, physical land mask directory and new output directory');
const meta=JSON.parse(await readFile(join(fixtureDir,'manifest.json'))),records=meta.records.filter(row=>row.tileSize===1024);
if(records.length!==4)throw Error('Four regional 1024 tiles required');
const minX=Math.min(...records.map(row=>row.window[0])),minY=Math.min(...records.map(row=>row.window[1]));
const images=[];
for(const row of records){
  const bytes=await readFile(join(fixtureDir,row.file));
  if(bytes.length!==row.webpBytes||createHash('sha256').update(bytes).digest('hex')!==row.webpSha256)throw Error('Tile identity mismatch');
  images.push({x:row.window[0]-minX,y:row.window[1]-minY,data:bytes.toString('base64'),sha256:row.webpSha256});
}
if(images.some(row=>![0,1024].includes(row.x)||![0,1024].includes(row.y)))throw Error('Fixture is not a 2x2 block');
const mask=JSON.parse(await readFile(join(maskDir,'manifest.json'))),maskBytes=await readFile(join(maskDir,mask.file));
if(mask.schema!=='pando-regional-physical-land-mask-v1'||mask.origin[0]!==minX-1||mask.origin[1]!==minY-1||
  mask.size[0]!==2050||mask.size[1]!==2050||maskBytes.length!==mask.bytes||
  createHash('sha256').update(maskBytes).digest('hex')!==mask.sha256)throw Error('Physical land mask identity or extent mismatch');
const out=resolve(outArg);await mkdir(out,{recursive:false});
const fragment=`#version 300 es
  precision highp float;precision highp int;
  uniform sampler2D uTerrain;uniform sampler2D uLandMask;uniform vec2 uResolution;uniform vec2 uCenter;uniform vec2 uOrigin;uniform float uRadius;
  uniform float uPhysicalStyle;out vec4 color;
  ${experimentColorGlsl()}
  vec2 samplePoint(ivec2 p,float land){vec4 e=texelFetch(uTerrain,clamp(p,ivec2(0),textureSize(uTerrain,0)-1),0);
    float height=floor(e.r*255.0+0.5)*256.0+floor(e.g*255.0+0.5)-12000.0;
    return vec2(land>0.5?max(height,0.0):min(height,0.0),e.b);}
  void main(){
    vec2 ray=(gl_FragCoord.xy-uResolution*0.5)/uRadius;
    float rho2=dot(ray,ray);if(rho2>=1.0){color=vec4(0.0,0.0,0.0,1.0);return;}
    float z=sqrt(1.0-rho2),lat0=radians(uCenter.y);
    float lat=asin(clamp(z*sin(lat0)+ray.y*cos(lat0),-1.0,1.0));
    float lon=radians(uCenter.x)+atan(ray.x,z*cos(lat0)-ray.y*sin(lat0));
    vec2 point=vec2((degrees(lon)+180.0)*120.0,(90.0-degrees(lat))*120.0)-uOrigin+vec2(0.5);
    if(any(lessThan(point,vec2(1.0)))||any(greaterThan(point,vec2(2048.0)))){color=vec4(0.08,0.08,0.08,1.0);return;}
    ivec2 cell=ivec2(floor(point));vec2 f=fract(point);
    float land=texelFetch(uLandMask,clamp(ivec2(floor(point+vec2(0.5))),ivec2(0),textureSize(uLandMask,0)-1),0).r;
    vec2 sampleValue=mix(mix(samplePoint(cell,land),samplePoint(cell+ivec2(1,0),land),f.x),
      mix(samplePoint(cell+ivec2(0,1),land),samplePoint(cell+ivec2(1,1),land),f.x),f.y);
    color=vec4(numericalTerrainColor(sampleValue.x,sampleValue.y,land,uPhysicalStyle),1.0);
  }`;
const palette=globalThis.PandoLabCanvasTerrainDem.paletteForTheme('light');
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={schema:'pando-screen-space-globe-fixture-v1',sourceSha256:meta.sourceSha256,
  origin:[minX,minY],center:[(minX+1024)/120-180,90-(minY+1024)/120],tiles:images.map(({x,y,sha256})=>({x,y,sha256})),
  landMaskSha256:mask.sha256,landMaskSourceSha256:mask.sourceSha256,
  browserVersion:browser.version(),runs:[],status:'running',
  limitations:['Standalone 2x2 regional fixture, not the Pando Viewer or the complete D candidate.',
    'Physical-land mask is rasterized at the DEM grid with no antialiasing, not proven equivalent to the Viewer vector stencil.',
    'No atlas eviction, misses, dates, theme or picking.',
    'Globe scale is illustrative, not verified against the Viewer camera.',
    'rAF is scheduling, not GPU presentation time; no paired A1 measurement here.']};
try{
  for(let i=1;i<=3;i++){
    const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
    try{
      await page.setContent('<!doctype html><title>Screen-space globe fixture</title><style>body{margin:0}canvas{width:1280px;height:800px}</style><canvas width="1280" height="800"></canvas>');
      const info=await page.evaluate(async({fragment,images,maskData,origin,center,colors,seaSurface,seaDeep})=>{
        const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true,antialias:false});
        if(!gl)throw Error('WebGL2 unavailable');
        const vertex='#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}';
        const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
          if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
        const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));
        gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,2050,2050,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        for(const item of images){const image=new Image();image.src='data:image/webp;base64,'+item.data;await image.decode();
          if(image.width!==1026||image.height!==1026)throw Error('Unexpected tile dimensions');
          gl.texSubImage2D(gl.TEXTURE_2D,0,item.x,item.y,gl.RGBA,gl.UNSIGNED_BYTE,image);}
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        const maskImage=new Image();maskImage.src='data:image/png;base64,'+maskData;await maskImage.decode();
        if(maskImage.width!==2050||maskImage.height!==2050)throw Error('Unexpected mask dimensions');
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,maskImage);
        const u=name=>gl.getUniformLocation(program,name);
        gl.uniform1i(u('uTerrain'),0);gl.uniform1i(u('uLandMask'),1);gl.uniform2f(u('uResolution'),canvas.width,canvas.height);
        gl.uniform2f(u('uOrigin'),origin[0],origin[1]);gl.uniform2f(u('uCenter'),center[0],center[1]);
        gl.uniform1f(u('uRadius'),canvas.height*.5*32);gl.uniform1f(u('uPhysicalStyle'),1);
        gl.uniform3fv(u('uTerrainLandColors[0]'),new Float32Array(colors));gl.uniform3fv(u('uTerrainSeaSurface'),new Float32Array(seaSurface));
        gl.uniform3fv(u('uTerrainSeaDeep'),new Float32Array(seaDeep));gl.viewport(0,0,canvas.width,canvas.height);
        const ext=gl.getExtension('WEBGL_debug_renderer_info');globalThis.draw=()=>gl.drawArrays(gl.TRIANGLES,0,3);
        globalThis.draw();gl.finish();if(gl.getError()!==gl.NO_ERROR)throw Error('Globe shader failed');
        return {version:gl.getParameter(gl.VERSION),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
      },{fragment,images,maskData:maskBytes.toString('base64'),origin:report.origin,center:report.center,colors:[...palette.landColors],
        seaSurface:[...palette.seaSurface],seaDeep:[...palette.seaDeep]});
      const gaps=await page.evaluate(()=>new Promise((done,reject)=>{const values=[];let last=null;const started=performance.now();
        const tick=now=>{if(now-started>180000){reject(Error('Frame timeout'));return;}if(last!==null)values.push(now-last);
          last=now;globalThis.draw();if(values.length>=300)done(values);else requestAnimationFrame(tick);};requestAnimationFrame(tick);}));
      await page.screenshot({path:join(out,`globe-${i}.png`)});
      const sorted=[...gaps].sort((a,b)=>a-b),p=q=>sorted[Math.floor((sorted.length-1)*q)];
      report.runs.push({index:i,info,frameGapsMs:gaps,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99)});
    }finally{await page.close();}
  }
  report.status='passed';
}catch(error){report.status='failed';report.error=String(error?.stack||error);}
finally{await browser.close();await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({status:report.status,runs:report.runs.length,error:report.error?.slice(0,300)}));
if(report.status!=='passed')process.exitCode=1;
