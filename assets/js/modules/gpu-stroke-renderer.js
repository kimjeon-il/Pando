import { isRenderDevice } from './render-device.js';
import { createGpuResourceBudget } from './gpu-resource-budget.js';

const FLOATS_PER_INSTANCE = 5;
const VERTICES_PER_SEGMENT = 6;
const CORNERS = new Float32Array([-1, 0, 1, 0, -1, 1, -1, 1, 1, 0, 1, 1]);

function colorRgb(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
  if (!match) return [0, 0, 0];
  const packed = Number.parseInt(match[1], 16);
  return [(packed >> 16 & 255) / 255, (packed >> 8 & 255) / 255, (packed & 255) / 255];
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('stroke shader allocation failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'stroke shader compile failed';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(device) {
  const { gl, version } = device;
  const vertexSource = version === 2 ? `#version 300 es
    precision highp float;precision highp int;
    layout(location=0) in vec2 aCorner;layout(location=1) in vec4 aSegment;layout(location=2) in float aPhase;
    uniform vec2 uViewport;uniform vec2 uTranslate;uniform float uScale;
    uniform vec3 uRowX;uniform vec3 uRowY;uniform vec3 uRowZ;uniform vec2 uFlatCenter;
    uniform float uWorldOffset;uniform int uMode;uniform float uHalfWidth;uniform int uRoundCap;
    out float vDepth;out float vAlong;out float vAcross;out float vSegmentLength;out float vLocalAlong;
    vec3 project(vec2 coord){float lon=coord.x*0.017453292519943;float lat=coord.y*0.017453292519943;vec2 p;float depth;
      if(uMode==0){vec3 q=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));p=uTranslate+uScale*vec2(dot(uRowX,q),dot(uRowY,q));depth=dot(uRowZ,q);}
      else{p=uTranslate+uScale*vec2(lon+uWorldOffset-uFlatCenter.x,-(lat-uFlatCenter.y));depth=1.0;}return vec3(p,depth);}
    void main(){vec3 start=project(aSegment.xy);vec3 end=project(aSegment.zw);vec2 direction=end.xy-start.xy;float lengthPx=max(length(direction),0.0001);direction/=lengthPx;
      float side=aCorner.x;float endpoint=aCorner.y;vec2 normal=vec2(-direction.y,direction.x);float cap=uRoundCap==1?uHalfWidth:0.0;
      float local=mix(-cap,lengthPx+cap,endpoint);vec2 p=start.xy+direction*local+normal*side*uHalfWidth;
      vDepth=mix(start.z,end.z,endpoint);vAlong=aPhase+max(0.0,min(lengthPx,local));vAcross=side*uHalfWidth;vSegmentLength=lengthPx;vLocalAlong=local;
      gl_Position=vec4(p.x*2.0/uViewport.x-1.0,1.0-p.y*2.0/uViewport.y,0.0,1.0);}`
    : `precision highp float;precision highp int;
    attribute vec2 aCorner;attribute vec4 aSegment;attribute float aPhase;
    uniform vec2 uViewport;uniform vec2 uTranslate;uniform float uScale;uniform vec3 uRowX;uniform vec3 uRowY;uniform vec3 uRowZ;uniform vec2 uFlatCenter;
    uniform float uWorldOffset;uniform int uMode;uniform float uHalfWidth;uniform int uRoundCap;
    varying float vDepth;varying float vAlong;varying float vAcross;varying float vSegmentLength;varying float vLocalAlong;
    vec3 project(vec2 coord){float lon=coord.x*0.017453292519943;float lat=coord.y*0.017453292519943;vec2 p;float depth;
      if(uMode==0){vec3 q=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));p=uTranslate+uScale*vec2(dot(uRowX,q),dot(uRowY,q));depth=dot(uRowZ,q);}
      else{p=uTranslate+uScale*vec2(lon+uWorldOffset-uFlatCenter.x,-(lat-uFlatCenter.y));depth=1.0;}return vec3(p,depth);}
    void main(){vec3 start=project(aSegment.xy);vec3 end=project(aSegment.zw);vec2 direction=end.xy-start.xy;float lengthPx=max(length(direction),0.0001);direction/=lengthPx;
      float side=aCorner.x;float endpoint=aCorner.y;vec2 normal=vec2(-direction.y,direction.x);float cap=uRoundCap==1?uHalfWidth:0.0;
      float local=mix(-cap,lengthPx+cap,endpoint);vec2 p=start.xy+direction*local+normal*side*uHalfWidth;
      vDepth=mix(start.z,end.z,endpoint);vAlong=aPhase+max(0.0,min(lengthPx,local));vAcross=side*uHalfWidth;vSegmentLength=lengthPx;vLocalAlong=local;
      gl_Position=vec4(p.x*2.0/uViewport.x-1.0,1.0-p.y*2.0/uViewport.y,0.0,1.0);}`;
  const fragmentSource = version === 2 ? `#version 300 es
    precision highp float;precision highp int;
    uniform int uMode;uniform int uRoundCap;uniform float uHalfWidth;uniform vec2 uDash;uniform vec4 uColor;
    in float vDepth;in float vAlong;in float vAcross;in float vSegmentLength;in float vLocalAlong;out vec4 outColor;
    void main(){if(uMode==0&&vDepth<0.0)discard;float period=uDash.x+uDash.y;if(uDash.x>0.0&&uDash.y>0.0&&mod(vAlong,max(1.0,period))>uDash.x)discard;
      if(uRoundCap==1){if(vLocalAlong<0.0&&length(vec2(vLocalAlong,vAcross))>uHalfWidth)discard;if(vLocalAlong>vSegmentLength&&length(vec2(vLocalAlong-vSegmentLength,vAcross))>uHalfWidth)discard;}outColor=uColor;}`
    : `precision highp float;precision highp int;
    uniform int uMode;uniform int uRoundCap;uniform float uHalfWidth;uniform vec2 uDash;uniform vec4 uColor;
    varying float vDepth;varying float vAlong;varying float vAcross;varying float vSegmentLength;varying float vLocalAlong;
    void main(){if(uMode==0&&vDepth<0.0)discard;float period=uDash.x+uDash.y;if(uDash.x>0.0&&uDash.y>0.0&&mod(vAlong,max(1.0,period))>uDash.x)discard;
      if(uRoundCap==1){if(vLocalAlong<0.0&&length(vec2(vLocalAlong,vAcross))>uHalfWidth)discard;if(vLocalAlong>vSegmentLength&&length(vec2(vLocalAlong-vSegmentLength,vAcross))>uHalfWidth)discard;}gl_FragColor=uColor;}`;
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error('stroke program allocation failed');
  gl.attachShader(program, vertex);gl.attachShader(program, fragment);gl.linkProgram(program);
  gl.deleteShader(vertex);gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'stroke program link failed';
    gl.deleteProgram(program);throw new Error(message);
  }
  const attributes = Object.freeze(Object.fromEntries(['aCorner', 'aSegment', 'aPhase'].map(name => [name, gl.getAttribLocation(program, name)])));
  const uniforms = Object.freeze(Object.fromEntries([
    'uViewport', 'uTranslate', 'uScale', 'uRowX', 'uRowY', 'uRowZ', 'uFlatCenter', 'uWorldOffset',
    'uMode', 'uHalfWidth', 'uRoundCap', 'uDash', 'uColor',
  ].map(name => [name, gl.getUniformLocation(program, name)])));
  return Object.freeze({ program, attributes, uniforms });
}

function normalizedOwnerRanges(ownerRanges, validIndices) {
  if (!ownerRanges || typeof ownerRanges !== 'object') return Object.freeze({});
  const ownerByInput = new Map();
  for (const [ownerId, range] of Object.entries(ownerRanges)) {
    const first = Math.max(0, Number(range?.first || 0));
    const count = Math.max(0, Number(range?.count || 0));
    for (let index = first; index < first + count; index += 1) ownerByInput.set(index, ownerId);
  }
  const output = {};
  validIndices.forEach((inputIndex, outputIndex) => {
    const ownerId = ownerByInput.get(inputIndex);
    if (!ownerId) return;
    const range = output[ownerId] || { first: outputIndex, count: 0 };
    range.count += 1;output[ownerId] = range;
  });
  return Object.freeze(Object.fromEntries(Object.entries(output).map(([key, value]) => [key, Object.freeze(value)])));
}

export function buildGpuStrokeInstances(startsEnds, chainPhase = null, ownerRanges = null) {
  const source = startsEnds instanceof Float32Array ? startsEnds : new Float32Array(startsEnds || []);
  const values = [];const validIndices = [];let invalidSegmentCount = 0;let accumulatedPhase = 0;let previousEnd = null;
  for (let offset = 0; offset + 3 < source.length; offset += 4) {
    const inputIndex = offset / 4;
    const startLon = Number(source[offset]);const startLat = Number(source[offset + 1]);
    const endLon = Number(source[offset + 2]);const endLat = Number(source[offset + 3]);
    if (![startLon, startLat, endLon, endLat].every(Number.isFinite)
      || Math.hypot(endLon - startLon, endLat - startLat) <= 1e-12) { invalidSegmentCount += 1;continue; }
    if (!previousEnd || Math.hypot(startLon - previousEnd[0], startLat - previousEnd[1]) > 1e-9) accumulatedPhase = 0;
    const suppliedPhase = Number(chainPhase?.[inputIndex]);
    values.push(startLon, startLat, endLon, endLat, Number.isFinite(suppliedPhase) ? suppliedPhase : accumulatedPhase);
    accumulatedPhase += Math.hypot(endLon - startLon, endLat - startLat);previousEnd = [endLon, endLat];validIndices.push(inputIndex);
  }
  return Object.freeze({
    instances: new Float32Array(values),segmentCount: validIndices.length,invalidSegmentCount,
    ownerRanges: normalizedOwnerRanges(ownerRanges, validIndices),
  });
}

export function resolveGpuStrokeRanges(resource, ownerIds = null) {
  const instanceCount = Math.max(0, Math.trunc(Number(resource?.instanceCount) || 0));
  if (!instanceCount) return Object.freeze([]);
  if (!Array.isArray(ownerIds)) return Object.freeze([Object.freeze({ first: 0, count: instanceCount })]);
  const seen = new Set();
  const ranges = [];
  for (const ownerId of ownerIds) {
    const key = String(ownerId || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const source = resource?.ownerRanges?.[key];
    const first = Math.max(0, Math.trunc(Number(source?.first) || 0));
    const count = Math.max(0, Math.trunc(Number(source?.count) || 0));
    if (!count || first >= instanceCount) continue;
    ranges.push(Object.freeze({ first, count: Math.min(count, instanceCount - first) }));
  }
  return Object.freeze(ranges);
}

// Compatibility export for geometry-level callers; GPU upload is instanced.
export const buildGpuStrokeRibbon = buildGpuStrokeInstances;

export function createGpuStrokeRenderer({ onError = null } = {}) {
  let device = null;let gl = null;let programInfo = null;let cornerBuffer = null;let instancing = null;
  const resources = new Map();
  const resourceBudget = createGpuResourceBudget();
  let contextLost = false;let gpuHealth = 'unchecked';let selfTestPassed = false;
  let selfTestCount = 0;let selfTestMs = 0;let selfTestFailureReason = '';
  let uploadBytes = 0;let buildCount = 0;let buildMs = 0;let drawCount = 0;let drawCallCount = 0;let drawMs = 0;
  let cacheHits = 0;let cacheMisses = 0;let failureCount = 0;let lastFailureStage = '';

  const setDivisor = (location, value) => {
    if (device.version === 2) gl.vertexAttribDivisor(location, value);
    else instancing.vertexAttribDivisorANGLE(location, value);
  };
  const drawInstanced = (count, instances) => {
    if (device.version === 2) gl.drawArraysInstanced(gl.TRIANGLES, 0, count, instances);
    else instancing.drawArraysInstancedANGLE(gl.TRIANGLES, 0, count, instances);
  };

  function captureState() {
    return {
      framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING),viewport: Array.from(gl.getParameter(gl.VIEWPORT)),
      program: gl.getParameter(gl.CURRENT_PROGRAM),arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
      activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE),texture: gl.getParameter(gl.TEXTURE_BINDING_2D),
      blend: gl.isEnabled(gl.BLEND),depth: gl.isEnabled(gl.DEPTH_TEST),cull: gl.isEnabled(gl.CULL_FACE),scissor: gl.isEnabled(gl.SCISSOR_TEST),
      colorMask: Array.from(gl.getParameter(gl.COLOR_WRITEMASK)),clearColor: Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE)),
    };
  }

  function restoreState(state) {
    const enabled = (cap, value) => value ? gl.enable(cap) : gl.disable(cap);
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer);gl.viewport(...state.viewport);gl.useProgram(state.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer);gl.activeTexture(state.activeTexture);gl.bindTexture(gl.TEXTURE_2D, state.texture);
    enabled(gl.BLEND, state.blend);enabled(gl.DEPTH_TEST, state.depth);enabled(gl.CULL_FACE, state.cull);enabled(gl.SCISSOR_TEST, state.scissor);
    gl.colorMask(...state.colorMask);gl.clearColor(...state.clearColor);
  }

  function bindGeometry(resource, firstInstance = 0) {
    const { aCorner, aSegment, aPhase } = programInfo.attributes;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);gl.enableVertexAttribArray(aCorner);gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);setDivisor(aCorner, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, resource.buffer);const stride = FLOATS_PER_INSTANCE * Float32Array.BYTES_PER_ELEMENT;const baseOffset = firstInstance * stride;
    gl.enableVertexAttribArray(aSegment);gl.vertexAttribPointer(aSegment, 4, gl.FLOAT, false, stride, baseOffset);setDivisor(aSegment, 1);
    gl.enableVertexAttribArray(aPhase);gl.vertexAttribPointer(aPhase, 1, gl.FLOAT, false, stride, baseOffset + 4 * Float32Array.BYTES_PER_ELEMENT);setDivisor(aPhase, 1);
    return [aCorner, aSegment, aPhase];
  }

  function releaseAttributes(locations) {
    for (const location of locations) { setDivisor(location, 0);gl.disableVertexAttribArray(location); }
  }

  function setViewUniforms(frameContext, worldOffset) {
    const uniforms = programInfo.uniforms;
    gl.uniform2f(uniforms.uViewport, frameContext.viewport[0], frameContext.viewport[1]);gl.uniform2f(uniforms.uTranslate, frameContext.translate[0], frameContext.translate[1]);
    gl.uniform1f(uniforms.uScale, frameContext.scale);gl.uniform3fv(uniforms.uRowX, frameContext.rowX);gl.uniform3fv(uniforms.uRowY, frameContext.rowY);gl.uniform3fv(uniforms.uRowZ, frameContext.rowZ);
    gl.uniform2f(uniforms.uFlatCenter, frameContext.flatCenter[0], frameContext.flatCenter[1]);gl.uniform1f(uniforms.uWorldOffset, worldOffset);gl.uniform1i(uniforms.uMode, frameContext.mode);
  }

  function applyBlendMode(mode) {
    gl.enable(gl.BLEND);
    if (mode === 'multiply') gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  function drawStyle(resource, style, frameContext, ownerIds = null) {
    const [red, green, blue] = colorRgb(style.color);const alpha = Math.max(0, Math.min(1, Number(style.alpha ?? 1)));const width = Math.max(0.25, Number(style.width || 1));
    gl.uniform1f(programInfo.uniforms.uHalfWidth, width / 2);gl.uniform1i(programInfo.uniforms.uRoundCap, style.cap === 'butt' ? 0 : 1);
    gl.uniform2f(programInfo.uniforms.uDash, Math.max(0, Number(style.dash?.[0]) || 0), Math.max(0, Number(style.dash?.[1]) || 0));gl.uniform4f(programInfo.uniforms.uColor, red, green, blue, alpha);
    const ranges = resolveGpuStrokeRanges(resource, ownerIds);
    let completedDraws = 0;
    for (const range of ranges) {
      const locations = bindGeometry(resource, range.first);
      for (const worldOffset of frameContext.worldOffsets || [0]) {
        setViewUniforms(frameContext, worldOffset);drawInstanced(VERTICES_PER_SEGMENT, range.count);drawCallCount += 1;completedDraws += 1;
      }
      releaseAttributes(locations);
    }
    return completedDraws;
  }

  function runSelfTest() {
    const started = performance.now();selfTestCount += 1;let saved = null;let texture = null;let framebuffer = null;let buffer = null;
    try {
      if (!gl || !programInfo || !cornerBuffer || !instancing) throw new Error('shader-program-unavailable');
      saved = captureState();texture = gl.createTexture();framebuffer = gl.createFramebuffer();buffer = gl.createBuffer();
      if (!texture || !framebuffer || !buffer) throw new Error('framebuffer-incomplete');
      gl.bindTexture(gl.TEXTURE_2D, texture);gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer-incomplete');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, 0, 0.5, 0, 0]), gl.STATIC_DRAW);
      gl.viewport(0, 0, 16, 16);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);gl.clearColor(0, 0, 0, 0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(programInfo.program);
      drawStyle({ buffer, instanceCount: 1, ownerRanges: {} }, { color: '#ffffff', alpha: 1, width: 3, cap: 'butt', dash: [0, 0] }, {
        viewport: [16, 16],translate: [8, 8],scale: 500,rowX: [1, 0, 0],rowY: [0, 1, 0],rowZ: [0, 0, 1],flatCenter: [0, 0],mode: 1,worldOffsets: [0],
      });
      const pixels = new Uint8Array(16 * 16 * 4);gl.readPixels(0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (!pixels.some((value, index) => index % 4 === 3 && value > 0)) throw new Error('zero-alpha-output');
      selfTestPassed = true;gpuHealth = 'healthy';selfTestFailureReason = '';return true;
    } catch (error) {
      selfTestPassed = false;gpuHealth = contextLost ? 'context-lost' : 'unhealthy';selfTestFailureReason = error?.message || 'draw-failed';failureCount += 1;lastFailureStage = 'self-test';
      onError?.({ stage: 'gpu-stroke-self-test', error });return false;
    } finally {
      try { if (buffer) gl?.deleteBuffer?.(buffer);if (framebuffer) gl?.deleteFramebuffer?.(framebuffer);if (texture) gl?.deleteTexture?.(texture);if (saved) restoreState(saved); }
      catch (error) { selfTestPassed = false;gpuHealth = 'unhealthy';selfTestFailureReason = 'state-restore-failed';onError?.({ stage: 'gpu-stroke-self-test-restore', error }); }
      selfTestMs += performance.now() - started;
    }
  }

  function initialize(nextDevice) {
    dispose();
    if (!isRenderDevice(nextDevice) || !nextDevice.capabilities.instancing) return false;
    device = nextDevice;gl = nextDevice.gl;instancing = nextDevice.version === 2 ? gl : gl.getExtension('ANGLE_instanced_arrays');
    try {
      programInfo = createProgram(nextDevice);cornerBuffer = gl.createBuffer();if (!cornerBuffer || !instancing) throw new Error('stroke instancing unavailable');
      gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);contextLost = false;return runSelfTest();
    } catch (error) { failureCount += 1;lastFailureStage = 'initialize';onError?.({ stage: 'gpu-stroke-initialize', error });return false; }
  }

  const resourceSignature = packet => `${String(packet?.key || '')}:${String(packet?.geometryRevision ?? 0)}:${String(packet?.lod || 'high')}`;

  function deleteResource(key) {
    const normalized = String(key || '');const resource = resources.get(normalized);if (!resource) return false;
    if (gl && !gl.isContextLost?.()) gl.deleteBuffer(resource.buffer);
    resources.delete(normalized);resourceBudget.remove(normalized);return true;
  }

  function ensureResource(packet) {
    const key = String(packet?.key || '');
    if (!key || !gl || !programInfo || contextLost || gpuHealth !== 'healthy') return { resource: null, reason: 'unavailable' };
    const signature = resourceSignature(packet);const previous = resources.get(key);
    if (previous?.signature === signature) { cacheHits += 1;resourceBudget.touch(key, packet?.priority);return { resource: previous, reason: '' }; }
    const started = performance.now();let buffer = null;
    try {
      const geometry = buildGpuStrokeInstances(packet.startsEnds, packet.chainPhase, packet.ownerRanges);
      if (!geometry.segmentCount) return { resource: null, reason: 'empty-geometry' };
      buffer = gl.createBuffer();if (!buffer) throw new Error('stroke buffer allocation failed');gl.bindBuffer(gl.ARRAY_BUFFER, buffer);gl.bufferData(gl.ARRAY_BUFFER, geometry.instances, gl.STATIC_DRAW);
      const resource = Object.freeze({ key, signature, buffer, instanceCount: geometry.segmentCount, ownerRanges: geometry.ownerRanges, byteLength: geometry.instances.byteLength });
      if (previous?.buffer) { gl.deleteBuffer(previous.buffer);resourceBudget.remove(key); }resources.set(key, resource);resourceBudget.track(key, geometry.instances.byteLength, packet?.priority);uploadBytes += geometry.instances.byteLength;buildCount += 1;cacheMisses += 1;return { resource, reason: '' };
    } catch (error) {
      if (buffer) gl.deleteBuffer(buffer);failureCount += 1;lastFailureStage = 'buffer-build';onError?.({ stage: 'gpu-stroke-buffer-build', key, error });return { resource: null, reason: error?.message || 'buffer-build-failed' };
    } finally { buildMs += performance.now() - started; }
  }

  function drawBatches(batches = [], frameContext) {
    const started = performance.now();drawCount += 1;const renderedKeys = [];const missingKeys = [];const failures = [];
    if (!gl || !programInfo || contextLost || gpuHealth !== 'healthy' || gl.isContextLost?.() || !frameContext) {
      return Object.freeze({ succeeded: false, renderedKeys, missingKeys: batches.map(batch => String(batch?.key || '')).filter(Boolean), failures });
    }
    gl.useProgram(programInfo.program);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
    for (const batch of batches) {
      const key = String(batch?.key || '');const { resource, reason } = ensureResource(batch);
      if (!resource) { if (key) missingKeys.push(key);failures.push({ key, reason });continue; }
      try {
        resourceBudget.touch(key, batch?.priority);
        const style = batch.style || {};applyBlendMode(batch.blendMode || style.blendMode);
        let completedDraws = 0;
        if (style.casing?.width > style.width && style.casing.alpha > 0) completedDraws += drawStyle(resource, { ...style, ...style.casing, cap: style.cap, dash: style.dash }, frameContext, batch.ownerIds);
        if (Number(style.alpha ?? 1) > 0 && Number(style.width || 0) > 0) completedDraws += drawStyle(resource, style, frameContext, batch.ownerIds);
        if (completedDraws > 0) {
          if (key) renderedKeys.push(key);
        } else {
          if (key) missingKeys.push(key);
          failures.push({ key, reason: Array.isArray(batch.ownerIds) ? 'owner-range-missing' : 'nothing-drawn' });
          failureCount += 1;lastFailureStage = 'draw-coverage';
        }
      } catch (error) {
        if (key) missingKeys.push(key);failures.push({ key, reason: error?.message || 'draw-failed' });failureCount += 1;lastFailureStage = 'draw';onError?.({ stage: 'gpu-stroke-draw', key, error });
      }
    }
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);drawMs += performance.now() - started;
    return Object.freeze({ succeeded: missingKeys.length === 0, renderedKeys: Object.freeze(renderedKeys), missingKeys: Object.freeze(missingKeys), failures: Object.freeze(failures) });
  }

  function retain(keys = [], { protectedKeys = [] } = {}) {
    if (!gl || gl.isContextLost?.()) return [];
    const evicted = resourceBudget.reconcile({ active: keys, protected: protectedKeys });for (const key of evicted) deleteResource(key);return evicted;
  }

  function setByteBudget(value) {
    const evicted = resourceBudget.setByteBudget(value);for (const key of evicted) deleteResource(key);return resourceBudget.stats().byteBudget;
  }

  function handleContextLost() {
    contextLost = true;gpuHealth = 'context-lost';selfTestPassed = false;resources.clear();resourceBudget.clear();programInfo = null;cornerBuffer = null;device = null;gl = null;instancing = null;
  }

  function dispose() {
    if (gl && !gl.isContextLost?.()) {
      for (const resource of resources.values()) gl.deleteBuffer(resource.buffer);
      if (cornerBuffer) gl.deleteBuffer(cornerBuffer);if (programInfo?.program) gl.deleteProgram(programInfo.program);
    }
    resources.clear();resourceBudget.clear();programInfo = null;cornerBuffer = null;device = null;gl = null;instancing = null;contextLost = false;gpuHealth = 'unchecked';selfTestPassed = false;
  }

  return Object.freeze({
    initialize,ensureResource,drawBatches,retain,setByteBudget,handleContextLost,dispose,runSelfTest,
    hasResource: key => resources.has(String(key || '')),
    resourceByteLength: key => Number(resources.get(String(key || ''))?.byteLength || 0),
    isAvailable: () => !!gl && !!programInfo && !contextLost && gpuHealth === 'healthy' && selfTestPassed,
    stats: () => Object.freeze({
      resourceCount: resources.size,uploadBytes,buildCount,buildMs,drawCount,drawCallCount,drawMs,cacheHits,cacheMisses,failureCount,lastFailureStage,contextLost,
      gpuHealth,selfTestPassed,selfTestCount,selfTestMs,selfTestFailureReason,activeBufferBytes: [...resources.values()].reduce((sum, resource) => sum + resource.byteLength, 0),resourceBudget: resourceBudget.stats(),
    }),
  });
}

export const GPU_STROKE_LAYOUT = Object.freeze({ floatsPerInstance: FLOATS_PER_INSTANCE, verticesPerSegment: VERTICES_PER_SEGMENT });
