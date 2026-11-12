// Owned by gpu-terrain-preparation. Optional surface textures never determine
// DEM readiness, evict required DEM, or create another visibility/LOD policy.
export function createGpuNaturalSurfaceCache({readTile,invalidate}) {
  const tiles=new Map(),pending=new Map(),failures=new Map(),missing=new Set();
  let generation=0,gl=null,scheduler=null,manifest=null,enabled=false,budget=0;
  let visible=new Set(),prepared=[],allowRequests=false,uploads=0,requests=0;
  const resident=()=>[...tiles.values()].reduce((n,t)=>n+t.bytes,0);
  const reserved=()=>[...pending.values()].reduce((n,t)=>n+t.bytes,0);
  const close=task=>{task.bitmap?.close?.();task.bitmap=null;};
  function remove(key) {
    const entry=tiles.get(key);if(!entry)return;
    if(gl&&!gl.isContextLost?.())gl.deleteTexture(entry.texture);
    tiles.delete(key);
  }
  function cancel(task) {
    task.controller.abort();
    scheduler?.cancelKey?.(task.uploadKey);
    close(task);
    if(pending.get(task.spec.key)===task)pending.delete(task.spec.key);
  }
  function trim(limit) {
    budget=Math.max(0,Number(limit)||0);
    // Cancel optional reservations before deleting any useful resident image.
    for(const task of [...pending.values()].reverse()) {
      if(resident()+reserved()<=budget)break;
      cancel(task);
    }
    const ordered=[...tiles.entries()].sort((a,b)=>Number(visible.has(a[0]))-Number(visible.has(b[0]))||a[1].used-b[1].used);
    for(const [key] of ordered){if(resident()+reserved()<=budget)break;remove(key);}
  }
  function current(task) {
    return task.generation===generation&&!task.controller.signal.aborted&&enabled&&visible.has(task.spec.key)
      &&pending.get(task.spec.key)===task;
  }
  function upload(task) {
    if(!current(task)||!task.bitmap){close(task);return {bytes:0,done:true};}
    const bitmap=task.bitmap,texture=gl.createTexture();
    if(!texture)throw Error('Natural terrain texture allocation failed');
    const previousPremultiply=gl.getParameter?.(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    const previousColor=gl.getParameter?.(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL);
    try {
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);
    }catch(error){gl.deleteTexture(texture);throw error;}
    finally{
      if(previousPremultiply!==undefined)gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,previousPremultiply);
      if(previousColor!==undefined)gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,previousColor);
      close(task);
    }
    tiles.set(task.spec.key,{texture,bytes:task.bytes,used:performance.now()});
    const bytes=task.bytes;task.bytes=0;uploads++;
    invalidate('terrain-natural-ready');
    return {bytes,done:true};
  }
  function start(spec) {
    const key=spec.key,entry=manifest.naturalSurface.tiles[`${spec.level}/${spec.column}-${spec.row}.webp`];
    if(!entry||tiles.has(key)||pending.has(key)||missing.has(key)||failures.has(key))return;
    const bytes=(spec.pixelWidth+2*manifest.gutter)*(spec.pixelHeight+2*manifest.gutter)*4;
    if(bytes>budget-resident()-reserved())return;
    const task={spec,bytes,generation,controller:new AbortController(),bitmap:null,uploadKey:`natural:${generation}:${key}`};
    pending.set(key,task);requests++;
    task.promise=Promise.resolve().then(()=>readTile(spec,manifest,task.controller.signal)).then(async blob=>{
      if(!current(task))return;
      if(!blob){missing.add(key);return;}
      const bitmap=await createImageBitmap(blob,{premultiplyAlpha:'none',colorSpaceConversion:'none'});
      if(!current(task)){bitmap.close?.();return;}
      task.bitmap=bitmap;
      if(bitmap.width!==spec.pixelWidth+2*manifest.gutter||bitmap.height!==spec.pixelHeight+2*manifest.gutter)
        throw Error('Natural terrain dimensions differ from DEM: '+key);
      await scheduler.enqueueUpload({key:task.uploadKey,contextGeneration:task.generation,priority:30,
        allowDuringInteraction:true,dispose:()=>close(task),step:()=>upload(task)});
    }).catch(error=>{
      if(current(task))failures.set(key,String(error?.message||error));
      // Natural failure is diagnostic only. No DEM failure or renderer switch.
    }).finally(()=>{
      close(task);
      if(pending.get(key)===task)pending.delete(key);
      if(task.generation===generation)pump();
    });
  }
  function pump() {
    if(!enabled||!allowRequests||!gl||!scheduler||!manifest?.naturalSurface||typeof readTile!=='function')return;
    for(const {spec} of prepared){if(pending.size>=2)break;start(spec);}
  }
  function reset() {
    generation++;
    for(const task of [...pending.values()])cancel(task);
    for(const key of [...tiles.keys()])remove(key);
    pending.clear();failures.clear();missing.clear();visible.clear();prepared=[];enabled=false;allowRequests=false;
  }
  return Object.freeze({
    prepare(records,options) {
      if(gl&&gl!==options.gl)reset();
      gl=options.gl;scheduler=options.scheduler;manifest=options.manifest;
      enabled=!!options.enabled;allowRequests=!!options.requiredReady;
      prepared=records;visible=new Set(enabled?records.map(record=>record.spec.key):[]);
      for(const task of [...pending.values()])if(!visible.has(task.spec.key))cancel(task);
      trim(options.budgetBytes);pump();
      for(const record of records){
        const natural=enabled?tiles.get(record.spec.key):null;
        if(natural)natural.used=performance.now();
        record.naturalTexture=natural?.texture||null;
        record.naturalMixWeight=natural?manifest.naturalSurface.mixWeight:0;
      }
    },
    trim,reset,
    retry(){failures.clear();pump();},
    bytes:resident,
    pendingBytes:reserved,
    stats:()=>({terrainNaturalCacheBytes:resident(),terrainNaturalPendingBytes:reserved(),
      terrainNaturalTilesLoaded:tiles.size,terrainNaturalFailures:failures.size,
      terrainNaturalRequests:requests,terrainNaturalUploadCount:uploads}),
  });
}
