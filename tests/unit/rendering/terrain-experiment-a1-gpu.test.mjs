import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {a1TerrainFragmentSource} from '../../../scripts/terrain-experiment/a1-shader.mjs';
import {createLandPalette} from '../../../scripts/terrain-experiment/quality.mjs';

test('WebGL1 and WebGL2 match the CPU numerical sampler and PCHIP', {timeout:60000}, async()=>{
  const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage(),heights=[-1000,256,2500,6500],samples=[[0,0],[1,0],[0,1],[1,1],[.2,.7],[.5,.5],[.8,.1],[.5,0,false]];
    for(const theme of ['light','dark']){
    const palette=globalThis.PandoLabCanvasTerrainDem.paletteForTheme(theme);
    for(const version of [1,2]){
      const output=await page.evaluate(({fragment,version,heights,samples,colors,seaSurface,seaDeep})=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
        const gl=canvas.getContext(version===2?'webgl2':'webgl',{preserveDrawingBuffer:true,antialias:false});
        if(!gl)throw Error('WebGL context unavailable');
        const vertex=`${version===2?'#version 300 es\n':''}precision highp float;
          ${version===2?'in':'attribute'} vec2 aPosition;${version===2?'out':'varying'} vec2 vUv;
          ${version===2?'out':'varying'} float vDepth;uniform vec2 uv;
          void main(){gl_Position=vec4(aPosition,0.0,1.0);vUv=uv;vDepth=1.0;}`;
        const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
          if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
        const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(p);
        if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
        const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
        const pos=gl.getAttribLocation(p,'aPosition');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
        const raw=new Uint8Array(16);heights.forEach((v,i)=>{const n=v+12000;raw.set([n>>8,n&255,212,255],i*4);});
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,2,2,0,gl.RGBA,gl.UNSIGNED_BYTE,raw);
        const u=name=>gl.getUniformLocation(p,name);
        gl.uniform1i(u('uTerrain'),0);gl.uniform1i(u('uMode'),1);gl.uniform2f(u('uTextureSize'),2,2);
        gl.uniform1f(u('uPhysicalStyle'),1);gl.uniform1f(u('uLandPass'),1);gl.uniform1f(u('uDarkTheme'),0);
        gl.uniform3fv(u('uTerrainLandColors[0]'),new Float32Array(colors));
        gl.uniform3fv(u('uTerrainSeaSurface'),new Float32Array(seaSurface));gl.uniform3fv(u('uTerrainSeaDeep'),new Float32Array(seaDeep));
        const values=samples.map(([x,y,land])=>{gl.uniform1f(u('uLandPass'),land===false?0:1);gl.uniform2f(u('uv'),(x+.5)/2,(y+.5)/2);gl.drawArrays(gl.TRIANGLES,0,6);
          const result=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,result);return [...result];});
        if(gl.getError()!==gl.NO_ERROR)throw Error('WebGL readback failed');return values;
      },{fragment:a1TerrainFragmentSource(version),version,heights,samples,colors:[...palette.landColors],
        seaSurface:[...palette.seaSurface],seaDeep:[...palette.seaDeep]});
      const stops=Array.from({length:8},(_,index)=>'#'+Array.from(palette.landColors.slice(index*3,index*3+3),value=>Math.round(value*255).toString(16).padStart(2,'0')).join(''));
      const pchip=createLandPalette(stops),flat=.27+.73*Math.SQRT1_2,illumination=Math.max(0,(212/255-.42)/.58);
      const shade=Math.max(.16,Math.min(1,flat+((.27+.73*illumination)-flat)*1.3));
      const factor=Math.max(.38,Math.min(1.3,shade/flat));
      for(let i=0;i<samples.length;i++){
        const [x,y,land]=samples[i],clamped=heights.map(value=>land===false?Math.min(value,0):Math.max(value,0));
        const height=(clamped[0]*(1-x)+clamped[1]*x)*(1-y)+(clamped[2]*(1-x)+clamped[3]*x)*y;
        const depth=Math.pow(Math.max(0,Math.min(1,-height/8000)),.6);
        const rgb=land===false?[...palette.seaSurface].map((value,c)=>255*(value*(1-depth)+palette.seaDeep[c]*depth)):pchip(height);
        const expected=rgb.map(value=>Math.round(Math.max(0,Math.min(255,value*factor))));
        for(let c=0;c<3;c++)assert.ok(Math.abs(output[i][c]-expected[c])<=2,`WebGL${version} sample ${i} channel ${c}: ${output[i][c]} vs ${expected[c]}`);
        const dem=new Uint8ClampedArray(16);
        heights.forEach((value,index)=>{const encoded=value+12000;dem.set([encoded>>8,encoded&255,212,255],index*4);});
        const cpu=globalThis.PandoLabCanvasTerrainDem.sampleInterpolated({dem,width:2,height:2,x,y,theme,channel:land===false?'ocean':'land'});
        for(let c=0;c<3;c++)assert.ok(Math.abs(output[i][c]-cpu[c])<=2,`CPU vs WebGL${version} sample ${i} channel ${c}: ${cpu[c]} vs ${output[i][c]}`);
      }
    }
    }
  }finally{await browser.close();}
});
