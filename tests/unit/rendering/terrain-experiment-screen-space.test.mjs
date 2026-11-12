import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {globePixelToLonLat} from '../../../scripts/terrain-experiment/viewer-screen-space.mjs';
import {createLandPalette} from '../../../scripts/terrain-experiment/quality.mjs';

test('screen-space globe inverse matches the Viewer orthographic rows',()=>{
  const frame={translate:[200,150],scale:300,rowX:[0,1,0],rowY:[0,0,-1],rowZ:[1,0,0]};
  assert.deepEqual(globePixelToLonLat(frame,200,150),[0,0]);
  for(const [lon,lat] of [[15,20],[-30,-10],[45,5]]){
    const rad=Math.PI/180,p=[Math.cos(lat*rad)*Math.cos(lon*rad),Math.cos(lat*rad)*Math.sin(lon*rad),Math.sin(lat*rad)];
    const dot=row=>row.reduce((sum,v,i)=>sum+v*p[i],0);
    const actual=globePixelToLonLat(frame,200+300*dot(frame.rowX),150+300*dot(frame.rowY));
    assert.ok(Math.abs(actual[0]-lon)<1e-9&&Math.abs(actual[1]-lat)<1e-9);
  }
  assert.equal(globePixelToLonLat(frame,501,150),null);
});

test('D pass reuses atlas and renders the same constant terrain color', {timeout:60000},async()=>{
  const bundled=await build({stdin:{contents:"export {createViewerScreenSpace} from './scripts/terrain-experiment/viewer-screen-space.mjs';",
    resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'browser',format:'iife',globalName:'ScreenExperiment',write:false});
  const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage();await page.goto('about:blank');await page.addScriptTag({content:bundled.outputFiles[0].text});
    const result=await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
      const gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true,antialias:false,stencil:true});if(!gl)throw Error('WebGL2 unavailable');
      const origin=[33792,7168],lon=(origin[0]+1024)/120-180,lat=90-(origin[1]+1024)/120;
      const l=lon*Math.PI/180,b=lat*Math.PI/180,center=[Math.cos(b)*Math.cos(l),Math.cos(b)*Math.sin(l),Math.sin(b)];
      const frame={mode:0,translate:[32,32],viewport:[64,64],scale:8000,
        rowX:[-Math.sin(l),Math.cos(l),0],rowY:[Math.sin(b)*Math.cos(l),Math.sin(b)*Math.sin(l),-Math.cos(b)],rowZ:center};
      const pixels=new Uint8Array(514*514*4),encoded=1000+12000;
      for(let i=0;i<pixels.length;i+=4)pixels.set([encoded>>8,encoded&255,212,255],i);
      const tiles=[];for(const col of [67,68])for(const row of [15,16]){
        const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,514,514,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        tiles.push({texture,gutter:1,spec:{level:5,column:col,row,pixelWidth:512,pixelHeight:512}});
      }
      gl.viewport(0,0,64,64);
      const pass=globalThis.ScreenExperiment.createViewerScreenSpace({origin,tileSize:512});
      const palette=globalThis.PandoLabCanvasTerrainDem.paletteForTheme('light');
      const input={gl,tiles,frame,pass:'land',physicalStyle:true,dark:false,palette};
      const before={program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),
        active:gl.getParameter(gl.ACTIVE_TEXTURE),read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)};
      const first=pass.draw(input),second=pass.draw(input),out=new Uint8Array(4);
      const restored=before.program===gl.getParameter(gl.CURRENT_PROGRAM)&&before.vao===gl.getParameter(gl.VERTEX_ARRAY_BINDING)
        &&before.active===gl.getParameter(gl.ACTIVE_TEXTURE)&&before.read===gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      gl.readPixels(32,32,1,1,gl.RGBA,gl.UNSIGNED_BYTE,out);
      const missing=pass.draw({...input,tiles:tiles.slice(0,1)});
      gl.stencilMask(0xff);gl.clearStencil(0);gl.clear(gl.STENCIL_BUFFER_BIT);gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0,0,32,64);gl.clearStencil(1);gl.clear(gl.STENCIL_BUFFER_BIT);gl.disable(gl.SCISSOR_TEST);
      gl.enable(gl.STENCIL_TEST);gl.stencilMask(0);gl.stencilFunc(gl.EQUAL,1,0xff);pass.draw(input);
      gl.stencilFunc(gl.NOTEQUAL,1,0xff);pass.draw({...input,pass:'ocean'});
      const land=new Uint8Array(4),ocean=new Uint8Array(4);
      gl.readPixels(16,32,1,1,gl.RGBA,gl.UNSIGNED_BYTE,land);gl.readPixels(48,32,1,1,gl.RGBA,gl.UNSIGNED_BYTE,ocean);
      return {first,second,missing,restored,pixel:[...out],land:[...land],ocean:[...ocean],stats:{...pass.stats},error:gl.getError()};
    });
    assert.equal(result.first,true);assert.equal(result.second,true);assert.equal(result.missing,false);
    assert.equal(result.restored,true);
    assert.equal(result.stats.atlasBuilds,1);assert.equal(result.stats.draws,4);assert.equal(result.error,0);
    const flat=.27+.73*Math.SQRT1_2,illumination=Math.max(0,(212/255-.42)/.58);
    const shade=Math.max(.16,Math.min(1,flat+((.27+.73*illumination)-flat)*1.3));
    const factor=Math.max(.38,Math.min(1.3,shade/flat)),expected=createLandPalette()(1000).map(value=>Math.round(value*factor));
    for(let i=0;i<3;i++)assert.ok(Math.abs(result.pixel[i]-expected[i])<=2);
    assert.equal(result.pixel[3],255);
    assert.notDeepEqual(result.land,result.ocean);
  }finally{await browser.close();}
});
