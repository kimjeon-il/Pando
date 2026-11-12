import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {a1TerrainFragmentSource} from '../../../scripts/terrain-experiment/a1-shader.mjs';
import {createTerrainTileBatch} from '../../../scripts/terrain-experiment/viewer-tile-batch.mjs';

test('batched terrain tiles match separate draws and preserve cached atlases', {timeout:60000},async()=>{
  assert.equal(typeof createTerrainTileBatch,'function');
  const bundle=await build({stdin:{contents:"export {createTerrainTileBatch} from './scripts/terrain-experiment/viewer-tile-batch.mjs';",
    resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'browser',format:'iife',globalName:'TileBatch',write:false});
  const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage();await page.goto('about:blank');await page.addScriptTag({content:bundle.outputFiles[0].text});
    const palette=globalThis.PandoLabCanvasTerrainDem.paletteForTheme('light');
    const result=await page.evaluate(({fragment,palette})=>{
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=80;
      const gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true,antialias:false});if(!gl)throw Error('WebGL2 unavailable');
      const vertex=`#version 300 es
        precision highp float;layout(location=0) in vec2 aGrid;
        uniform vec4 uGeoBounds;uniform vec4 uUvBounds;uniform vec2 uViewport;uniform vec2 uTranslate;
        uniform vec2 uFlatCenter;uniform float uScale;uniform float uWorldOffset;
        out vec2 vUv;out float vDepth;
        void main(){vec2 ll=mix(uGeoBounds.xy,uGeoBounds.zw,aGrid)*0.017453292519943295;
          vec2 p=uTranslate+uScale*vec2(ll.x+uWorldOffset-uFlatCenter.x,-(ll.y-uFlatCenter.y));
          gl_Position=vec4(p.x*2.0/uViewport.x-1.0,1.0-p.y*2.0/uViewport.y,0,1);
          vUv=mix(uUvBounds.xy,uUvBounds.zw,aGrid);vDepth=1.0;}`;
      const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
      const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
      const grid={vertexBuffer:gl.createBuffer(),indexBuffer:gl.createBuffer(),indexCount:6};
      gl.bindBuffer(gl.ARRAY_BUFFER,grid.vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,1,1]),gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,grid.indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array([0,2,1,1,2,3]),gl.STATIC_DRAW);
      const tiles=[];for(const col of [66,67]){
        const pixels=new Uint8Array(514*514*4);for(let y=0;y<514;y++)for(let x=0;x<514;x++){
          const h=12000+300+col*4+Math.floor(x/8)+Math.floor(y/12),i=(y*514+x)*4;
          pixels.set([h>>8,h&255,212,255],i);
        }
        const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,514,514,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        const west=col*512/120-180,north=90-14*512/120;
        tiles.push({texture,grid,gutter:1,spec:{level:5,column:col,row:14,pixelWidth:512,pixelHeight:512,bounds:[west,north,west+512/120,north-512/120]}});
      }
      const frame={mode:1,viewport:[128,80],translate:[64,40],scale:700,flatCenter:[(67*512/120-180)*Math.PI/180,(90-14.5*512/120)*Math.PI/180],
        rowX:[1,0,0],rowY:[0,1,0],rowZ:[0,0,1],worldOffsets:[0]};
      const uniforms=(p,offset)=>{const u=n=>gl.getUniformLocation(p,n);gl.uniform2fv(u('uViewport'),frame.viewport);gl.uniform2fv(u('uTranslate'),frame.translate);
        gl.uniform2fv(u('uFlatCenter'),frame.flatCenter);gl.uniform1f(u('uScale'),frame.scale);gl.uniform1f(u('uWorldOffset'),offset);gl.uniform1i(u('uMode'),frame.mode);};
      const common=p=>{const u=n=>gl.getUniformLocation(p,n);gl.uniform1i(u('uTerrain'),1);gl.uniform1f(u('uPhysicalStyle'),1);gl.uniform1f(u('uLandPass'),1);
        gl.uniform1f(u('uDarkTheme'),0);gl.uniform3fv(u('uTerrainLandColors[0]'),palette.landColors);gl.uniform3fv(u('uTerrainSeaSurface'),palette.seaSurface);gl.uniform3fv(u('uTerrainSeaDeep'),palette.seaDeep);};
      gl.viewport(0,0,128,80);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(program);common(program);uniforms(program,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,grid.vertexBuffer);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,grid.indexBuffer);
      for(const tile of tiles){gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,tile.texture);gl.uniform4fv(gl.getUniformLocation(program,'uGeoBounds'),tile.spec.bounds);
        gl.uniform4f(gl.getUniformLocation(program,'uUvBounds'),1/514,1/514,513/514,513/514);gl.uniform2f(gl.getUniformLocation(program,'uTextureSize'),514,514);
        gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_INT,0);}
      const reference=new Uint8Array(128*80*4);gl.readPixels(0,0,128,80,gl.RGBA,gl.UNSIGNED_BYTE,reference);
      gl.clear(gl.COLOR_BUFFER_BIT);const batch=globalThis.TileBatch.createTerrainTileBatch();
      const input={gl,tiles,frame,pass:'land',physicalStyle:true,dark:false,palette,vertexSource:vertex,fragmentSource:fragment,setViewUniforms:uniforms};
      const before={program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),array:gl.getParameter(gl.ARRAY_BUFFER_BINDING),
        active:gl.getParameter(gl.ACTIVE_TEXTURE),read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)};
      const first=batch.draw(input),second=batch.draw(input),actual=new Uint8Array(reference.length);gl.readPixels(0,0,128,80,gl.RGBA,gl.UNSIGNED_BYTE,actual);
      const restored=before.program===gl.getParameter(gl.CURRENT_PROGRAM)&&before.vao===gl.getParameter(gl.VERTEX_ARRAY_BINDING)&&before.array===gl.getParameter(gl.ARRAY_BUFFER_BINDING)
        &&before.active===gl.getParameter(gl.ACTIVE_TEXTURE)&&before.read===gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      const constrained=globalThis.TileBatch.createTerrainTileBatch({maxAtlasBytes:0}),fallback=constrained.draw(input);
      batch.dispose(gl);const disposedBytes=batch.stats.atlasBytes,recreated=batch.draw(input);
      let max=0,changed=0;for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-reference[i]);max=Math.max(max,d);if(d>2)changed++;}
      return {first,second,restored,fallback,disposedBytes,recreated,max,changed,stats:{...batch.stats},error:gl.getError()};
    },{fragment:a1TerrainFragmentSource(2),palette:{landColors:[...palette.landColors],seaSurface:[...palette.seaSurface],seaDeep:[...palette.seaDeep]}});
    assert.equal(result.first,true);assert.equal(result.second,true);assert.equal(result.error,0);
    assert.equal(result.restored,true);assert.equal(result.fallback,false);
    assert.equal(result.changed,0);assert.ok(result.max<=2);assert.equal(result.disposedBytes,0);assert.equal(result.recreated,true);
    assert.equal(result.stats.atlasBuilds,2);assert.equal(result.stats.draws,3);assert.equal(result.stats.instances,6);
  }finally{await browser.close();}
});
