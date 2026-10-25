import {expect,test} from '@playwright/test';
import {deflateSync} from 'node:zlib';
import {terrainDemFragmentSource} from "../../shared/frontend/js/modules/terrain-dem-shaders.js";

test.use({viewport:{width:1440,height:900},launchOptions:{args:process.platform==='win32'?['--use-angle=d3d11']:[]},trace:'off'});

// Flat encoded elevation with deliberately coarse precomputed shade. The
// production shader must derive the same detailed light before/during input.
for (const version of [1,2]) test(`WebGL${version} prepared elevation keeps detailed shading without a later settle transition`,async({page})=>{
  await page.goto('about:blank');
  const rgba=await page.evaluate(({fragment,version})=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const gl=canvas.getContext(version===2?'webgl2':'webgl');if(!gl)throw new Error(`WebGL${version} required`);
    const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;};
    const program=gl.createProgram();
    gl.attachShader(program,compile(gl.VERTEX_SHADER,`${version===2?'#version 300 es\n':''}precision highp float;${version===2?'in':'attribute'} vec2 aPosition;${version===2?'out':'varying'} vec2 vUv;${version===2?'out':'varying'} vec2 vLonLat;${version===2?'out':'varying'} float vDepth;void main(){gl_Position=vec4(aPosition,0,1);vUv=vec2(0.5);vLonLat=vec2(0);vDepth=1.0;}`));
    gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const position=gl.getAttribLocation(program,'aPosition');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    const texture=(unit,width,height,rgba)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,rgba);};
    const pixels=new Uint8Array(4*4*4);for(let i=0;i<pixels.length;i+=4)pixels.set([46,224,128,255],i);
    texture(0,4,4,pixels);texture(1,1,1,new Uint8Array([200,100,50,255]));
    const loc=name=>gl.getUniformLocation(program,name);gl.uniform1i(loc('uTerrain'),0);gl.uniform1i(loc('uTint'),1);gl.uniform1i(loc('uMode'),1);gl.uniform2f(loc('uTextureSize'),4,4);gl.uniform2f(loc('uLevelSize'),43200,21600);gl.uniform1f(loc('uPhysicalStyle'),0);gl.uniform1f(loc('uLandPass'),1);gl.uniform1f(loc('uDarkTheme'),0);gl.uniform1f(loc('uDetailedShade'),1);
    gl.drawArrays(gl.TRIANGLES,0,3);const result=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,result);return [...result];
  },{fragment:terrainDemFragmentSource(version),version});
  expect(rgba).toEqual([212,212,212,255]);
});

function png(width,height){
  const crc=buffer=>{let crc=0xffffffff;for(const b of buffer){crc^=b;for(let i=0;i<8;i++)crc=crc>>>1^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const name=Buffer.from(type),size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([size,name,data,checksum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)raw.set([46,224,128,255],y*(width*4+1)+1+x*4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

for(const viewport of [{width:1440,height:900,dpr:1},{width:390,height:844,dpr:2}]) test.describe(`${viewport.width}px terrain streaming`,()=>{
test.use({viewport:{width:viewport.width,height:viewport.height},deviceScaleFactor:viewport.dpr,hasTouch:viewport.dpr===2});
test('current-view detail reaches an actual WebGL frame while the pointer remains held',async({page})=>{
  const manifest={version:'0.13.3',representation:'dem-relief-v1',crs:'EPSG:4326',extent:[-180,-90,180,90],gutter:1,tileFormat:'lossless WebP RGBA',registration:'cell-center',sourceGridOrigin:[-180,90],sourceResolutionDegrees:[1/120,1/120],elevation:{decode:'R*256+G-12000',biasMeters:12000,spacingMeters:1,validEncodedRange:[0,65535]},channels:{r:'encoded elevation high byte',g:'encoded elevation low byte',b:'precomputed hillshade',a:'255'},shade:{azimuthDegrees:315,altitudeDegrees:45,ambient:.42,diffuse:.58,polarFallbackDegrees:89.5},tint:{url:'terrain/v0.13.3/tint.webp',width:4,height:2},assetsSha256:'a'.repeat(64),sources:[],urlTemplate:'terrain/v0.13.3/{level}/{column}-{row}.webp',levels:Array.from({length:6},(_,id)=>({id,width:1350*2**id,height:675*2**id,tileSize:1024,columns:Math.ceil(1350*2**id/1024),rows:Math.ceil(675*2**id/1024)}))};
  const images=new Map();
  await page.route('https://kimjeon-il.github.io/PandoLab-library-data/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('manifest.json'))return route.fulfill({json:manifest});
    let width=4,height=2;const match=path.match(/\/(\d+)\/(\d+)-(\d+)\.webp$/);
    if(match){const level=manifest.levels[+match[1]];width=Math.min(1024,level.width-Number(match[2])*1024)+2;height=Math.min(1024,level.height-Number(match[3])*1024)+2;}
    const key=`${width}x${height}`;if(!images.has(key))images.set(key,png(width,height));
    await route.fulfill({contentType:'image/png',body:images.get(key)});
  });
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.__detailedTerrainDraws=[];
    const proto=window.WebGL2RenderingContext.prototype,getLocation=proto.getUniformLocation,draw=proto.drawElements;
    const programs=new WeakMap();
    proto.getUniformLocation=function(program,name){const value=getLocation.call(this,program,name);if(name==='uDetailedShade')programs.set(program,value);return value;};
    proto.drawElements=function(...args){const result=draw.apply(this,args);if(window.__captureTerrainDraws){const program=this.getParameter(this.CURRENT_PROGRAM),location=program&&programs.get(program);if(location)window.__detailedTerrainDraws.push(this.getUniform(program,location));}return result;};
  });
  await page.goto('/?debug=1',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true',{timeout:60000});
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().mapReadiness.status),{timeout:30000}).toBe('ready');
  const box=await page.locator('#map').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+8,box.y+box.height/2);
  try{
    await page.locator('#map').evaluate(map=>{const r=map.getBoundingClientRect();map.dispatchEvent(new window.WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,deltaY:-1800}));});
    await expect.poll(()=>page.evaluate(()=>{const s=window.__PANDOLAB_VIEWER__.rendererStats();return s.screenScale>=642&&s.terrainTargetLevel===5&&s.terrainRenderedLevel===5&&s.terrainDetailedShade&&s.mapReadiness.status==='ready';}),{timeout:5000}).toBe(true);
    expect(errors).toEqual([]);
  }finally{await page.mouse.up();}
  if(viewport.dpr===1){
    // Globe camera scale drives terrain preparation independently of scene reprojection.
    const zoom=async scale=>{
      await page.locator('#map').evaluate((map,scale)=>{const r=map.getBoundingClientRect(),current=window.__PANDOLAB_VIEWER__.rendererStats().screenScale;map.dispatchEvent(new window.WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,deltaY:-Math.log(scale/current)/.0013}));},scale);
      await expect.poll(()=>page.evaluate(scale=>Math.abs(window.__PANDOLAB_VIEWER__.rendererStats().screenScale-scale),scale)).toBeLessThan(1);
    };
    await zoom(450);await zoom(620);
    await expect.poll(()=>page.evaluate(()=>{const s=window.__PANDOLAB_VIEWER__.rendererStats();return s.screenScale>615&&s.screenScale<625&&s.mapReadiness.status==='ready';})).toBe(true);
    await page.evaluate(()=>{window.__detailedTerrainDraws=[];window.__captureTerrainDraws=true;});
    await zoom(650);
    await expect.poll(()=>page.evaluate(()=>window.__detailedTerrainDraws.includes(1)),{timeout:3000}).toBe(true);
    await zoom(3000);
    await expect.poll(()=>page.evaluate(()=>{const s=window.__PANDOLAB_VIEWER__.rendererStats();return s.terrainTargetLevel===4&&s.mapReadiness.status==='ready';})).toBe(true);
    await page.mouse.down();
    try{
      await zoom(3200);
      await expect.poll(()=>page.evaluate(()=>{const s=window.__PANDOLAB_VIEWER__.rendererStats();return s.terrainTargetLevel===5&&s.terrainRenderedLevel===5&&s.mapReadiness.status==='ready';}),{timeout:3000}).toBe(true);
    }finally{await page.mouse.up();}
    expect(errors).toEqual([]);
  }
});
});
