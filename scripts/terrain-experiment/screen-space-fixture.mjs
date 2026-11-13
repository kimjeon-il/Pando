#!/usr/bin/env node
// Isolated single-tile screen-space feasibility fixture, not a Viewer backend.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createLandPalette } from './quality.mjs';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Expected input WebP tile and new output directory');
const inputBytes=await readFile(input),palette=createLandPalette();
const lut=new Uint8Array(4096*4);
for(let i=0;i<4096;i++){
  const rgb=palette(i*6500/4095);
  for(let c=0;c<3;c++)lut[i*4+c]=Math.round(rgb[c]);
  lut[i*4+3]=255;
}
await mkdir(output);
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const runs=[];
try{
  for(let repeat=1;repeat<=3;repeat++){
    const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
    try{
      await page.setContent('<!doctype html><title>Terrain single-tile GPU experiment</title><style>body{margin:0;background:#111}canvas{width:1280px;height:800px}</style><canvas width="1280" height="800"></canvas>');
      const info=await page.evaluate(async({data,paletteBytes})=>{
        const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});
        if(!gl)throw Error('WebGL2 unavailable');
        const vertex=`#version 300 es
          void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
        const fragment=`#version 300 es
          precision highp float;precision highp int;
          uniform sampler2D uTile;uniform sampler2D uLut;uniform vec2 uResolution;
          out vec4 result;
          vec2 decode(ivec2 p){vec4 v=texelFetch(uTile,clamp(p,ivec2(0),textureSize(uTile,0)-1),0);
            return vec2(floor(v.r*255.0+0.5)*256.0+floor(v.g*255.0+0.5)-12000.0,v.b);}
          void main(){vec2 uv=gl_FragCoord.xy/uResolution;uv.y=1.0-uv.y;
            vec2 p=uv*vec2(textureSize(uTile,0))-0.5;ivec2 a=ivec2(floor(p));vec2 f=fract(p);
            vec2 h=mix(mix(decode(a),decode(a+ivec2(1,0)),f.x),mix(decode(a+ivec2(0,1)),decode(a+ivec2(1,1)),f.x),f.y);
            vec3 col=texture(uLut,vec2(clamp(h.x/6500.0,0.0,1.0),0.5)).rgb;
            result=vec4(col*h.y,1.0);}`;
        function compile(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
          if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
        const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
        const img=new Image();img.src='data:image/webp;base64,'+data;await img.decode();
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);gl.uniform1i(gl.getUniformLocation(program,'uTile'),0);
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,4096,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(paletteBytes));gl.uniform1i(gl.getUniformLocation(program,'uLut'),1);
        gl.uniform2f(gl.getUniformLocation(program,'uResolution'),canvas.width,canvas.height);gl.viewport(0,0,canvas.width,canvas.height);
        const ext=gl.getExtension('WEBGL_debug_renderer_info');
        globalThis.draw=()=>gl.drawArrays(gl.TRIANGLES,0,3);
        globalThis.draw();gl.finish();
        if(gl.getError()!==gl.NO_ERROR)throw Error('WebGL failed');
        return {version:gl.getParameter(gl.VERSION),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),tileWidth:img.width,tileHeight:img.height};
      },{data:inputBytes.toString('base64'),paletteBytes:Array.from(lut)});
      const gaps=await page.evaluate(()=>new Promise((resolve,reject)=>{
        const raw=[];let last=null;const started=performance.now();
        function frame(now){if(now-started>180000){reject(Error('300-frame timeout'));return;}
          if(last!==null)raw.push(now-last);last=now;globalThis.draw();
          if(raw.length>=300)resolve(raw);else requestAnimationFrame(frame);}
        requestAnimationFrame(frame);
      }));
      await page.screenshot({path:`${output}/screen-space-${repeat}.png`});
      const sorted=[...gaps].sort((a,b)=>a-b),at=p=>sorted[Math.floor((sorted.length-1)*p)];
      runs.push({repeat,info,frameGapsMs:gaps,p50Ms:at(.5),p95Ms:at(.95),p99Ms:at(.99)});
    }finally{await page.close();}
  }
  const report={schema:'pando-terrain-screen-space-fixture-v1',browserVersion:browser.version(),runs,
    limitations:['Single rectangular sample; no Viewer, globe inverse projection, physical-land mask, tiles or cache.',
      'PCHIP is represented by a 4096-entry 8-bit lookup table; water palette is not implemented.',
      'rAF gaps measure scheduling, not GPU presentation or GPU time.',
      'Runs are feasibility observations only and are not comparable with the P7 runner.']};
  await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({runs:runs.length,p95:runs.map(x=>x.p95Ms),renderer:runs[0].info.renderer}));
}finally{await browser.close();}
