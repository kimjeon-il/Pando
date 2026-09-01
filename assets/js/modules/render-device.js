function detectWebGlVersion(gl) {
  if (!gl) return 0;
  const webGl2 = typeof globalThis.WebGL2RenderingContext !== 'undefined'
    && gl instanceof globalThis.WebGL2RenderingContext;
  return webGl2 ? 2 : 1;
}

export function createRenderDevice({ gl, canvas = null, version = 0, contextRevision = 0 } = {}) {
  if (!gl) return null;
  const resolvedVersion = Number(version) || detectWebGlVersion(gl);
  if (![1, 2].includes(resolvedVersion)) return null;
  const uintIndices = resolvedVersion === 2 || !!gl.getExtension?.('OES_element_index_uint');
  const instancing = resolvedVersion === 2 || !!gl.getExtension?.('ANGLE_instanced_arrays');
  const attributes = gl.getContextAttributes?.() || {};
  return Object.freeze({
    gl,
    canvas,
    version: resolvedVersion,
    contextRevision: Math.max(0, Number(contextRevision) || 0),
    capabilities: Object.freeze({
      uintIndices,
      instancing,
      stencil: !!attributes.stencil,
      maxTextureSize: Number(gl.getParameter?.(gl.MAX_TEXTURE_SIZE) || 0),
    }),
  });
}

export function isRenderDevice(value) {
  return !!value?.gl && [1, 2].includes(Number(value.version)) && !!value.capabilities;
}
