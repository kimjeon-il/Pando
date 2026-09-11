import { isRenderDevice } from './render-device.js';
import { createGpuResourceBudget } from './gpu-resource-budget.js';
import { applyGpuBlendMode, parseGpuColor, resetGpuNormalBlend } from './gpu-blend-utils.js';
import { linkGpuProgram } from './gpu-shader-utils.js';
import { GPU_VIEW_UNIFORM_NAMES, setGpuViewUniforms } from './gpu-view-uniforms.js';

function createProgram(device) {
  const { gl, version } = device;
  const vertexSource = version === 2 ? `#version 300 es
    precision highp float;precision highp int;
    layout(location=0) in vec2 aCoord;
    uniform vec2 uViewport;uniform vec2 uTranslate;uniform float uScale;
    uniform vec3 uRowX;uniform vec3 uRowY;uniform vec3 uRowZ;uniform vec2 uFlatCenter;
    uniform float uWorldOffset;uniform int uMode;
    out float vDepth;
    void main(){float lon=aCoord.x*0.017453292519943;float lat=aCoord.y*0.017453292519943;vec2 p;
      if(uMode==0){vec3 q=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));p=uTranslate+uScale*vec2(dot(uRowX,q),dot(uRowY,q));vDepth=dot(uRowZ,q);}
      else{p=uTranslate+uScale*vec2(lon+uWorldOffset-uFlatCenter.x,-(lat-uFlatCenter.y));vDepth=1.0;}
      gl_Position=vec4(p.x*2.0/uViewport.x-1.0,1.0-p.y*2.0/uViewport.y,0.0,1.0);}`
    : `precision highp float;precision highp int;
    attribute vec2 aCoord;
    uniform vec2 uViewport;uniform vec2 uTranslate;uniform float uScale;
    uniform vec3 uRowX;uniform vec3 uRowY;uniform vec3 uRowZ;uniform vec2 uFlatCenter;
    uniform float uWorldOffset;uniform int uMode;
    varying float vDepth;
    void main(){float lon=aCoord.x*0.017453292519943;float lat=aCoord.y*0.017453292519943;vec2 p;
      if(uMode==0){vec3 q=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));p=uTranslate+uScale*vec2(dot(uRowX,q),dot(uRowY,q));vDepth=dot(uRowZ,q);}
      else{p=uTranslate+uScale*vec2(lon+uWorldOffset-uFlatCenter.x,-(lat-uFlatCenter.y));vDepth=1.0;}
      gl_Position=vec4(p.x*2.0/uViewport.x-1.0,1.0-p.y*2.0/uViewport.y,0.0,1.0);}`;
  const fragmentSource = version === 2 ? `#version 300 es
    precision mediump float;precision highp int;
    uniform int uMode;uniform vec4 uColor;in float vDepth;out vec4 outColor;
    void main(){if(uMode==0&&vDepth<0.0)discard;outColor=uColor;}`
    : `precision mediump float;precision highp int;
    uniform int uMode;uniform vec4 uColor;varying float vDepth;
    void main(){if(uMode==0&&vDepth<0.0)discard;gl_FragColor=uColor;}`;
  const program = linkGpuProgram(gl, vertexSource, fragmentSource, { label: 'polygon overlay' });
  return Object.freeze({
    program,
    coord: gl.getAttribLocation(program, 'aCoord'),
    uniforms: Object.freeze(Object.fromEntries([
      ...GPU_VIEW_UNIFORM_NAMES, 'uColor',
    ].map(name => [name, gl.getUniformLocation(program, name)]))),
  });
}

export function createGpuPolygonOverlayPass({ onError = null, onResourceReady = null } = {}) {
  let uploadScheduler = null;
  const pendingUploads = new Map();
  let gl = null;
  let programInfo = null;
  let contextLost = false;
  const resources = new Map();
  const resourceBudget = createGpuResourceBudget();
  let uploadBytes = 0;
  let buildCount = 0;
  let buildMs = 0;
  let drawCount = 0;
  let drawCallCount = 0;
  let drawMs = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  let failureCount = 0;
  let lastFailureStage = '';

  function initialize(nextDevice) {
    dispose();
    if (!isRenderDevice(nextDevice) || !nextDevice.capabilities.uintIndices) return false;
    gl = nextDevice.gl;
    try {
      programInfo = createProgram(nextDevice);
      contextLost = false;
      return true;
    } catch (error) {
      failureCount += 1;
      lastFailureStage = 'initialize';
      onError?.({ stage: 'gpu-polygon-initialize', error });
      return false;
    }
  }

  function signature(packet) {
    return `${String(packet?.key || '')}:${String(packet?.geometryRevision ?? 0)}:${String(packet?.lod || 'high')}`;
  }

  function deleteResource(key) {
    const normalized = String(key || '');
    const resource = resources.get(normalized);
    if (!resource) return false;
    if (gl && !gl.isContextLost?.()) {
      gl.deleteBuffer(resource.positionBuffer);
      gl.deleteBuffer(resource.indexBuffer);
    }
    resources.delete(normalized);
    resourceBudget.remove(normalized);
    return true;
  }

  function ensureResource(packet) {
    const key = String(packet?.key || '');
    if (!key || !gl || !programInfo || contextLost) return { resource: null, reason: 'unavailable' };
    const nextSignature = signature(packet);
    const previous = resources.get(key);
    if (previous?.signature === nextSignature) {
      cacheHits += 1;
      resourceBudget.touch(key, packet?.priority);
      return { resource: previous, reason: '' };
    }
    if (!(packet.positions instanceof Float32Array) || !(packet.indices instanceof Uint32Array)
      || packet.positions.length < 6 || packet.indices.length < 3) {
      return { resource: null, reason: 'empty-geometry' };
    }
    if (uploadScheduler) {
      if (pendingUploads.get(key)?.signature === nextSignature) return { resource: null, reason: 'upload-pending' };
      uploadScheduler.cancelKey('polygon:' + key);
      const uploadGl = gl, job = { signature: nextSignature, part: 0, offset: 0, buffers: [] };
      pendingUploads.set(key, job);
      void uploadScheduler.enqueueUpload({
        key: 'polygon:' + key, priority: 50,
        dispose: () => { for (const buffer of job.buffers) uploadGl.deleteBuffer(buffer); if (pendingUploads.get(key) === job) pendingUploads.delete(key); },
        step: ({ byteBudget }) => {
          if (gl !== uploadGl || contextLost || pendingUploads.get(key) !== job) throw Object.assign(new Error('Stale polygon upload'), { name: 'AbortError' });
          if (job.part === 2) {
            const resource = Object.freeze({ key, signature: nextSignature, positionBuffer: job.buffers[0], indexBuffer: job.buffers[1], indexCount: packet.indices.length, byteLength: packet.positions.byteLength + packet.indices.byteLength });
            if (previous) { gl.deleteBuffer(previous.positionBuffer); gl.deleteBuffer(previous.indexBuffer); }
            resources.set(key, resource); resourceBudget.track(key, resource.byteLength, packet.priority); pendingUploads.delete(key); buildCount++; cacheMisses++;
            onResourceReady?.(key); return { done: true };
          }
          const data = job.part ? packet.indices : packet.positions, target = job.part ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER;
          const binding = gl.getParameter(job.part ? gl.ELEMENT_ARRAY_BUFFER_BINDING : gl.ARRAY_BUFFER_BINDING);
          try {
            if (!job.buffers[job.part]) {
              const buffer = gl.createBuffer(); if (!buffer) throw new Error('Polygon staging allocation failed');
              job.buffers[job.part] = buffer; gl.bindBuffer(target, buffer); gl.bufferData(target, data.byteLength, gl.STATIC_DRAW); return { bytes: 0 };
            }
            gl.bindBuffer(target, job.buffers[job.part]);
            const bytes = Math.min(byteBudget, data.byteLength - job.offset);
            gl.bufferSubData(target, job.offset, new Uint8Array(data.buffer, data.byteOffset + job.offset, bytes));
            job.offset += bytes; uploadBytes += bytes;
            if (job.offset === data.byteLength) { job.part++; job.offset = 0; }
            return { bytes };
          } finally { gl.bindBuffer(target, binding); }
        },
      }).catch(error => { if (error.name !== 'AbortError') onError?.({ stage: 'polygon-upload', error }); });
      return { resource: null, reason: 'upload-pending' };
    }
    const started = performance.now();
    let positionBuffer = null;
    let indexBuffer = null;
    try {
      positionBuffer = gl.createBuffer();
      indexBuffer = gl.createBuffer();
      if (!positionBuffer || !indexBuffer) throw new Error('polygon overlay buffer allocation failed');
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, packet.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, packet.indices, gl.STATIC_DRAW);
      const byteLength = packet.positions.byteLength + packet.indices.byteLength;
      const resource = Object.freeze({
        key,
        signature: nextSignature,
        positionBuffer,
        indexBuffer,
        indexCount: packet.indices.length,
        byteLength,
      });
      if (previous) {
        gl.deleteBuffer(previous.positionBuffer);
        gl.deleteBuffer(previous.indexBuffer);
        resourceBudget.remove(key);
      }
      resources.set(key, resource);
      resourceBudget.track(key, byteLength, packet?.priority);
      uploadBytes += byteLength;
      buildCount += 1;
      cacheMisses += 1;
      return { resource, reason: '' };
    } catch (error) {
      if (positionBuffer) gl.deleteBuffer(positionBuffer);
      if (indexBuffer) gl.deleteBuffer(indexBuffer);
      failureCount += 1;
      lastFailureStage = 'buffer-build';
      onError?.({ stage: 'gpu-polygon-buffer-build', key, error });
      return { resource: null, reason: error?.message || 'buffer-build-failed' };
    } finally {
      buildMs += performance.now() - started;
    }
  }

  function setViewUniforms(frameContext, worldOffset) {
    return setGpuViewUniforms(gl, { frameContext, worldOffset, getLocation: name => programInfo.uniforms[name] });
  }

  function drawPackets(packets = [], frameContext, { styleByKey = null } = {}) {
    const started = performance.now();
    drawCount += 1;
    const renderedKeys = [];
    const missingKeys = [];
    if (!gl || !programInfo || contextLost || gl.isContextLost?.() || !frameContext) {
      return Object.freeze({ succeeded: false, renderedKeys, missingKeys: packets.map(packet => String(packet?.key || '')).filter(Boolean) });
    }
    gl.useProgram(programInfo.program);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    for (const packet of packets) {
      const key = String(packet?.key || '');
      const { resource } = ensureResource(packet);
      if (!resource) {
        if (key) missingKeys.push(key);
        continue;
      }
      try {
        resourceBudget.touch(key, packet?.priority);
        const style = styleByKey?.get?.(key) || packet.style || {};
        const [red, green, blue] = parseGpuColor(style.color);
        const alpha = Math.max(0, Math.min(1, Number(style.fillAlpha ?? style.alpha ?? 1)));
        if (alpha <= 0) {
          if (key) renderedKeys.push(key);
          continue;
        }
        applyGpuBlendMode(gl, packet.blendMode || style.blendMode);
        gl.uniform4f(programInfo.uniforms.uColor, red, green, blue, alpha);
        gl.bindBuffer(gl.ARRAY_BUFFER, resource.positionBuffer);
        gl.enableVertexAttribArray(programInfo.coord);
        gl.vertexAttribPointer(programInfo.coord, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resource.indexBuffer);
        for (const worldOffset of frameContext.worldOffsets || [0]) {
          setViewUniforms(frameContext, worldOffset);
          gl.drawElements(gl.TRIANGLES, resource.indexCount, gl.UNSIGNED_INT, 0);
          drawCallCount += 1;
        }
        gl.disableVertexAttribArray(programInfo.coord);
        if (key) renderedKeys.push(key);
      } catch (error) {
        if (key) missingKeys.push(key);
        failureCount += 1;
        lastFailureStage = 'draw';
        onError?.({ stage: 'gpu-polygon-draw', key, error });
      }
    }
    resetGpuNormalBlend(gl);
    drawMs += performance.now() - started;
    return Object.freeze({
      succeeded: missingKeys.length === 0,
      renderedKeys: Object.freeze(renderedKeys),
      missingKeys: Object.freeze(missingKeys),
    });
  }

  // Interaction fills must reuse existing geometry resources. This path avoids
  // passing synthetic geometry packets back through ensureResource().
  function drawResourceItems(items = [], frameContext) {
    const started = performance.now();
    drawCount += 1;
    const renderedKeys = [];
    const missingKeys = [];
    if (!gl || !programInfo || contextLost || gl.isContextLost?.() || !frameContext) {
      return Object.freeze({ succeeded: false, renderedKeys, missingKeys: items.map(item => String(item?.key || '')).filter(Boolean) });
    }
    gl.useProgram(programInfo.program);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    for (const item of items) {
      const key = String(item?.key || '');
      const resource = resources.get(key);
      if (!resource) {
        if (key) missingKeys.push(key);
        continue;
      }
      try {
        resourceBudget.touch(key, item?.priority);
        const style = item.style || {};
        const [red, green, blue] = parseGpuColor(style.color);
        const alpha = Math.max(0, Math.min(1, Number(style.fillAlpha ?? style.alpha ?? 1)));
        applyGpuBlendMode(gl, item.blendMode || style.blendMode);
        gl.uniform4f(programInfo.uniforms.uColor, red, green, blue, alpha);
        gl.bindBuffer(gl.ARRAY_BUFFER, resource.positionBuffer);
        gl.enableVertexAttribArray(programInfo.coord);
        gl.vertexAttribPointer(programInfo.coord, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resource.indexBuffer);
        for (const worldOffset of frameContext.worldOffsets || [0]) {
          setViewUniforms(frameContext, worldOffset);
          gl.drawElements(gl.TRIANGLES, resource.indexCount, gl.UNSIGNED_INT, 0);
          drawCallCount += 1;
        }
        gl.disableVertexAttribArray(programInfo.coord);
        if (key) renderedKeys.push(key);
      } catch (error) {
        if (key) missingKeys.push(key);
        failureCount += 1;
        lastFailureStage = 'interaction-draw';
        onError?.({ stage: 'gpu-polygon-interaction-draw', key, error });
      }
    }
    resetGpuNormalBlend(gl);
    drawMs += performance.now() - started;
    return Object.freeze({ succeeded: missingKeys.length === 0, renderedKeys: Object.freeze(renderedKeys), missingKeys: Object.freeze(missingKeys) });
  }

  function retain(keys = [], { protectedKeys = [] } = {}) {
    if (!gl || gl.isContextLost?.()) return [];
    const evicted = resourceBudget.reconcile({ active: keys, protected: protectedKeys });
    for (const key of evicted) deleteResource(key);
    return evicted;
  }

  function setByteBudget(value) {
    const evicted = resourceBudget.setByteBudget(value);
    for (const key of evicted) deleteResource(key);
    return resourceBudget.stats().byteBudget;
  }

  function handleContextLost() {
    resources.clear();
    resourceBudget.clear();
    programInfo = null;
    contextLost = true;
    gl = null;
  }

  function dispose() {
    for (const key of pendingUploads.keys()) uploadScheduler?.cancelKey('polygon:' + key);
    if (gl && !gl.isContextLost?.()) {
      for (const resource of resources.values()) {
        gl.deleteBuffer(resource.positionBuffer);
        gl.deleteBuffer(resource.indexBuffer);
      }
      if (programInfo?.program) gl.deleteProgram(programInfo.program);
    }
    resources.clear();
    resourceBudget.clear();
    programInfo = null;
    gl = null;
    contextLost = false;
  }

  return Object.freeze({
    initialize,
    setUploadScheduler: scheduler => { uploadScheduler = scheduler; },
    ensureResource,
    drawPackets,
    drawResourceItems,
    retain,
    setByteBudget,
    handleContextLost,
    dispose,
    hasResource: key => resources.has(String(key || '')),
    isAvailable: () => !!gl && !!programInfo && !contextLost,
    stats: () => Object.freeze({
      resourceCount: resources.size,
      uploadBytes,
      buildCount,
      buildMs,
      drawCount,
      drawCallCount,
      drawMs,
      cacheHits,
      cacheMisses,
      failureCount,
      lastFailureStage,
      contextLost,
      activeBufferBytes: [...resources.values()].reduce((sum, resource) => sum + resource.byteLength, 0),
      resourceBudget: resourceBudget.stats(),
    }),
  });
}
