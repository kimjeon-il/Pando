// Experiment-only GPU pass for the existing Viewer stencil and camera.
import {experimentColorGlsl} from './a1-shader.mjs';

export function globePixelToLonLat(frame,x,y){
  const a=(x-frame.translate[0])/frame.scale,b=(y-frame.translate[1])/frame.scale,r=a*a+b*b;
  if(r>=1)return null;
  const c=Math.sqrt(1-r),p=[0,1,2].map(i=>a*frame.rowX[i]+b*frame.rowY[i]+c*frame.rowZ[i]);
  return [Math.atan2(p[1],p[0])*180/Math.PI,Math.asin(Math.max(-1,Math.min(1,p[2])))*180/Math.PI];
}

const vertex=`#version 300 es
  void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
const fragment=`#version 300 es
  precision highp float;precision highp int;
  uniform sampler2D uTerrain;uniform vec2 uViewport;uniform vec2 uTranslate;uniform float uScale;
  uniform vec3 uRowX;uniform vec3 uRowY;uniform vec3 uRowZ;uniform vec2 uOrigin;
  uniform float uPhysicalStyle;uniform float uLandPass;uniform float uDarkTheme;
  out vec4 outColor;
  ${experimentColorGlsl()}
  vec2 demValue(ivec2 point){vec4 e=texelFetch(uTerrain,clamp(point,ivec2(0),textureSize(uTerrain,0)-1),0);
    float h=floor(e.r*255.0+0.5)*256.0+floor(e.g*255.0+0.5)-12000.0;
    if(uPhysicalStyle>0.5)h=uLandPass>0.5?max(h,0.0):min(h,0.0);return vec2(h,e.b);}
  void main(){
    vec2 pixel=vec2(gl_FragCoord.x,uViewport.y-gl_FragCoord.y),ray=(pixel-uTranslate)/uScale;
    float r=dot(ray,ray);if(r>=1.0)discard;
    vec3 p=ray.x*uRowX+ray.y*uRowY+sqrt(1.0-r)*uRowZ;
    float lon=degrees(atan(p.y,p.x)),lat=degrees(asin(clamp(p.z,-1.0,1.0)));
    vec2 point=vec2((lon+180.0)*120.0,(90.0-lat)*120.0)-uOrigin+vec2(0.5);
    if(any(lessThan(point,vec2(1.0)))||any(greaterThan(point,vec2(2048.0))))discard;
    ivec2 cell=ivec2(floor(point));vec2 f=fract(point);
    vec2 value=mix(mix(demValue(cell),demValue(cell+ivec2(1,0)),f.x),
      mix(demValue(cell+ivec2(0,1)),demValue(cell+ivec2(1,1)),f.x),f.y);
    vec3 color=numericalTerrainColor(value.x,value.y,uLandPass,uPhysicalStyle);
    if(uPhysicalStyle<0.5)color*=mix(1.0,${globalThis.PandoLabCanvasTerrainDem.darkBrightness.toFixed(8)},uDarkTheme);
    outColor=vec4(color,1.0);
  }`;

function compile(gl,type,source){
  const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('D shader: '+gl.getShaderInfoLog(shader));return shader;
}
function createState(gl){
  const program=gl.createProgram(),vs=compile(gl,gl.VERTEX_SHADER,vertex),fs=compile(gl,gl.FRAGMENT_SHADER,fragment);
  gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('D link: '+gl.getProgramInfoLog(program));
  return {program,vao:gl.createVertexArray(),atlas:null,textures:[],keys:'',framebuffer:gl.createFramebuffer()};
}

// Only the bounded regional fixture is supported. Returning false preserves the
// existing loading frame; measured acceptance requires actual D draws later.
export function createViewerScreenSpace({origin,tileSize=512}={}){
  if(!Array.isArray(origin)||origin.length!==2||origin.some(x=>!Number.isInteger(x))||tileSize!==512)
    throw TypeError('D requires the aligned 512 regional fixture');
  const contexts=new WeakMap(),stats={draws:0,fallbacks:0,atlasBuilds:0,atlasBytes:0};
  return {stats,draw({gl,tiles,frame,pass,physicalStyle,dark,palette}){
    if(!gl||typeof gl.createVertexArray!=='function'||!frame||frame.mode!==0||!Array.isArray(tiles)||!palette){stats.fallbacks++;return false;}
    const candidates=tiles.filter(tile=>tile.spec?.level===5&&tile.spec.pixelWidth===tileSize&&tile.spec.pixelHeight===tileSize&&tile.gutter===1
      &&tile.spec.column*tileSize>=origin[0]&&tile.spec.column*tileSize+tileSize<=origin[0]+2048
      &&tile.spec.row*tileSize>=origin[1]&&tile.spec.row*tileSize+tileSize<=origin[1]+2048);
    const byKey=new Map(candidates.map(tile=>[`${tile.spec.column},${tile.spec.row}`,tile]));
    if(!byKey.size){stats.fallbacks++;return false;}
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(let y=0;y<=16;y++)for(let x=0;x<=16;x++){
      const ll=globePixelToLonLat(frame,frame.viewport[0]*x/16,frame.viewport[1]*y/16);if(!ll)continue;
      const px=(ll[0]+180)*120,py=(90-ll[1])*120;
      minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);
    }
    if(!Number.isFinite(minX)||minX<origin[0]+1||maxX>origin[0]+2047||minY<origin[1]+1||maxY>origin[1]+2047){stats.fallbacks++;return false;}
    for(let row=Math.floor(minY/tileSize);row<=Math.floor(maxY/tileSize);row++)
      for(let col=Math.floor(minX/tileSize);col<=Math.floor(maxX/tileSize);col++)
        if(!byKey.has(`${col},${row}`)){stats.fallbacks++;return false;}
    let state=contexts.get(gl);
    if(!state||!gl.isProgram(state.program)){state=createState(gl);contexts.set(gl,state);}
    const ordered=[...byKey].sort(([a],[b])=>a.localeCompare(b)),keys=ordered.map(([key])=>key).join('|');
    const previous={program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),
      active:gl.getParameter(gl.ACTIVE_TEXTURE),read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)};
    gl.activeTexture(gl.TEXTURE1);previous.texture=gl.getParameter(gl.TEXTURE_BINDING_2D);
    try{
      if(!state.atlas||keys!==state.keys||ordered.some(([,tile],i)=>state.textures[i]!==tile.texture)){
        if(state.atlas)gl.deleteTexture(state.atlas);state.atlas=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,state.atlas);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,2050,2050,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER,state.framebuffer);
        for(const [,tile] of ordered){
          const x=tile.spec.column*tileSize-origin[0],y=tile.spec.row*tileSize-origin[1];
          if(x<0||y<0||x+tileSize+2>2050||y+tileSize+2>2050)throw Error('D tile outside atlas');
          gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tile.texture,0);
          if(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('D source framebuffer incomplete');
          gl.copyTexSubImage2D(gl.TEXTURE_2D,0,x,y,0,0,tileSize+2,tileSize+2);
        }
        state.keys=keys;state.textures=ordered.map(([,tile])=>tile.texture);stats.atlasBuilds++;stats.atlasBytes=2050*2050*4;
      }
      gl.bindTexture(gl.TEXTURE_2D,state.atlas);gl.useProgram(state.program);gl.bindVertexArray(state.vao);
      const u=name=>gl.getUniformLocation(state.program,name);
      gl.uniform1i(u('uTerrain'),1);gl.uniform2fv(u('uViewport'),frame.viewport);gl.uniform2fv(u('uTranslate'),frame.translate);
      gl.uniform1f(u('uScale'),frame.scale);gl.uniform3fv(u('uRowX'),frame.rowX);gl.uniform3fv(u('uRowY'),frame.rowY);gl.uniform3fv(u('uRowZ'),frame.rowZ);
      gl.uniform2fv(u('uOrigin'),origin);gl.uniform1f(u('uPhysicalStyle'),physicalStyle?1:0);gl.uniform1f(u('uLandPass'),pass==='land'?1:0);
      gl.uniform1f(u('uDarkTheme'),dark?1:0);gl.uniform3fv(u('uTerrainLandColors[0]'),palette.landColors);
      gl.uniform3fv(u('uTerrainSeaSurface'),palette.seaSurface);gl.uniform3fv(u('uTerrainSeaDeep'),palette.seaDeep);
      gl.drawArrays(gl.TRIANGLES,0,3);stats.draws++;return true;
    }finally{
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,previous.read);gl.bindTexture(gl.TEXTURE_2D,previous.texture);
      gl.activeTexture(previous.active);gl.bindVertexArray(previous.vao);gl.useProgram(previous.program);
    }
  }};
}
