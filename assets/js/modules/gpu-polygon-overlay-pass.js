import { isRenderDevice } from './render-device.js';
import { createGpuResourceBudget } from './gpu-resource-budget.js';

function colorRgb(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
  if (!match) return [0, 0, 0];
  const packed = Number.parseInt(match[1], 16);
  return [(packed >> 16 & 255) / 255, (packed >> 8 & 255) / 255, (packed & 255) / 255];
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('polygon overlay shader allocation failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'polygon overlay shader compile failed';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

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
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('polygon overlay program allocation failed');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'polygon overlay program link failed';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return Object.freeze({
    program,
    coord: gl.getAttribLocation(program, 'aCoord'),
    uniforms: Object.freeze(Object.fromEntries([
      'uViewport', 'uTranslate', 'uScale', 'uRowX', 'uRowY', 'uRowZ', 'uFlatCenter', 'uWorldOffset', 'uMode', 'uColor',
    ].map(name => [name, gl.getUniformLocation(program, name)]))),
  });
}

export function createGpuPolygonOverlayPass({ onError = null } = {}) {
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
    const uniforms = programInfo.uniforms;
    gl.uniform2f(uniforms.uViewport, frameContext.viewport[0], frameContext.viewport[1]);
    gl.uniform2f(uniforms.uTranslate, frameContext.translate[0], frameContext.translate[1]);
    gl.uniform1f(uniforms.uScale, frameContext.scale);
    gl.uniform3fv(uniforms.uRowX, frameContext.rowX);
    gl.uniform3fv(uniforms.uRowY, frameContext.rowY);
    gl.uniform3fv(uniforms.uRowZ, frameContext.rowZ);
    gl.uniform2f(uniforms.uFlatCenter, frameContext.flatCenter[0], frameContext.flatCenter[1]);
    gl.uniform1f(uniforms.uWorldOffset, worldOffset);
    gl.uniform1i(uniforms.uMode, frameContext.mode);
  }

  function applyBlendMode(mode) {
    gl.enable(gl.BLEND);
    if (mode === 'multiply') gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
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
        const [red, green, blue] = colorRgb(style.color);
        const alpha = Math.max(0, Math.min(1, Number(style.fillAlpha ?? style.alpha ?? 1)));
        if (alpha <= 0) {
          if (key) renderedKeys.push(key);
          continue;
        }
        applyBlendMode(packet.blendMode || style.blendMode);
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
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
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
        const [red, green, blue] = colorRgb(style.color);
        const alpha = Math.max(0, Math.min(1, Number(style.fillAlpha ?? style.alpha ?? 1)));
        applyBlendMode(item.blendMode || style.blendMode);
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
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
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
