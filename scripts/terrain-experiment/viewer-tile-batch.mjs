// Experiment-only WebGL2 instancing of existing 512 terrain tile meshes.
// A bounded 3x3 texture atlas retains each tile's own one-pixel gutter.
function programFor(gl,vertexSource,fragmentSource){
  const markerA='uniform vec4 uGeoBounds;',markerB='uniform vec4 uUvBounds;';
  if(vertexSource.split(markerA).length!==2||vertexSource.split(markerB).length!==2)
    throw Error('B terrain vertex contract changed');
  const vertex=vertexSource.replace(markerA,'layout(location=1) in vec4 uGeoBounds;')
    .replace(markerB,'layout(location=2) in vec4 uUvBounds;');
  const compile=(kind,source)=>{const shader=gl.createShader(kind);gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('B shader: '+gl.getShaderInfoLog(shader));return shader;};
  const program=gl.createProgram(),vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragmentSource);
  gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('B link: '+gl.getProgramInfoLog(program));return program;
}

export function createTerrainTileBatch({maxAtlasBytes=64*1024*1024}={}){
  const contexts=new WeakMap(),stats={draws:0,instances:0,atlasBuilds:0,atlasBytes:0,fallbacks:0};
  return {stats,dispose(gl){
    const state=contexts.get(gl);if(!state)return false;
    for(const atlas of state.atlases)gl.deleteTexture(atlas);
    gl.deleteFramebuffer(state.framebuffer);gl.deleteBuffer(state.instances);gl.deleteVertexArray(state.vao);gl.deleteProgram(state.program);
    contexts.delete(gl);stats.atlasBytes=0;return true;
  },draw({gl,tiles,frame,pass,physicalStyle,dark,palette,vertexSource,fragmentSource,setViewUniforms}){
    const side=514,atlasSide=side*3,atlasBytes=atlasSide*atlasSide*4;
    if(!gl||typeof gl.drawElementsInstanced!=='function'||!frame||!palette||typeof setViewUniforms!=='function'||
      !Array.isArray(tiles)||!tiles.length||tiles.some(tile=>tile.spec?.level!==5||tile.spec.pixelWidth!==512||tile.spec.pixelHeight!==512||tile.gutter!==1||!tile.grid||!tile.texture)||
      Math.ceil(tiles.length/9)*atlasBytes>maxAtlasBytes||gl.getParameter(gl.MAX_TEXTURE_SIZE)<atlasSide){stats.fallbacks++;return false;}
    const ordered=[...tiles].sort((a,b)=>a.spec.row-b.spec.row||a.spec.column-b.spec.column);
    let state=contexts.get(gl);
    if(!state||!gl.isProgram(state.program)){
      state={program:programFor(gl,vertexSource,fragmentSource),vao:gl.createVertexArray(),instances:gl.createBuffer(),
        framebuffer:gl.createFramebuffer(),atlases:[],textures:[],signature:''};contexts.set(gl,state);
    }
    const signature=ordered.map(tile=>`${tile.spec.level}/${tile.spec.column}-${tile.spec.row}`).join('|');
    const previous={program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),
      active:gl.getParameter(gl.ACTIVE_TEXTURE),read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),array:gl.getParameter(gl.ARRAY_BUFFER_BINDING)};
    gl.activeTexture(gl.TEXTURE1);previous.texture=gl.getParameter(gl.TEXTURE_BINDING_2D);
    try{
      if(signature!==state.signature||ordered.some((tile,i)=>state.textures[i]!==tile.texture)){
        for(const atlas of state.atlases)gl.deleteTexture(atlas);state.atlases=[];
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER,state.framebuffer);
        for(let start=0;start<ordered.length;start+=9){
          const atlas=gl.createTexture();state.atlases.push(atlas);gl.bindTexture(gl.TEXTURE_2D,atlas);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,atlasSide,atlasSide,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
          for(let i=0;i<Math.min(9,ordered.length-start);i++){
            gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,ordered[start+i].texture,0);
            if(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('B source framebuffer incomplete');
            gl.copyTexSubImage2D(gl.TEXTURE_2D,0,(i%3)*side,Math.floor(i/3)*side,0,0,side,side);
          }
          stats.atlasBuilds++;
        }
        state.signature=signature;state.textures=ordered.map(tile=>tile.texture);stats.atlasBytes=state.atlases.length*atlasBytes;
      }
      gl.useProgram(state.program);gl.bindVertexArray(state.vao);
      const u=name=>gl.getUniformLocation(state.program,name);
      gl.uniform1i(u('uTerrain'),1);gl.uniform2f(u('uTextureSize'),atlasSide,atlasSide);
      gl.uniform1f(u('uPhysicalStyle'),physicalStyle?1:0);gl.uniform1f(u('uLandPass'),pass==='land'?1:0);gl.uniform1f(u('uDarkTheme'),dark?1:0);
      gl.uniform3fv(u('uTerrainLandColors[0]'),palette.landColors);gl.uniform3fv(u('uTerrainSeaSurface'),palette.seaSurface);gl.uniform3fv(u('uTerrainSeaDeep'),palette.seaDeep);
      for(let start=0;start<ordered.length;start+=9){
        gl.bindTexture(gl.TEXTURE_2D,state.atlases[Math.floor(start/9)]);
        const groups=new Map();
        for(let i=0;i<Math.min(9,ordered.length-start);i++){
          const tile=ordered[start+i],x=(i%3)*side,y=Math.floor(i/3)*side;
          if(!groups.has(tile.grid))groups.set(tile.grid,[]);
          groups.get(tile.grid).push(...tile.spec.bounds,(x+1)/atlasSide,(y+1)/atlasSide,(x+513)/atlasSide,(y+513)/atlasSide);
        }
        for(const [grid,values] of groups){
          gl.bindBuffer(gl.ARRAY_BUFFER,grid.vertexBuffer);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,grid.indexBuffer);gl.bindBuffer(gl.ARRAY_BUFFER,state.instances);
          gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.DYNAMIC_DRAW);
          for(const [location,offset] of [[1,0],[2,16]]){gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,4,gl.FLOAT,false,32,offset);gl.vertexAttribDivisor(location,1);}
          for(const offset of frame.worldOffsets){setViewUniforms(state.program,offset,frame);gl.drawElementsInstanced(gl.TRIANGLES,grid.indexCount,gl.UNSIGNED_INT,0,values.length/8);
            stats.draws++;stats.instances+=values.length/8;}
        }
      }
      return true;
    }finally{
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,previous.read);gl.bindTexture(gl.TEXTURE_2D,previous.texture);gl.activeTexture(previous.active);
      gl.bindVertexArray(previous.vao);gl.bindBuffer(gl.ARRAY_BUFFER,previous.array);gl.useProgram(previous.program);
    }
  }};
}
