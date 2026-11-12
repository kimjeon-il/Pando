import {createRenderDevice,isRenderDevice} from '../../src/rendering/render-device.js';

// Uses the production RenderDevice factory. Only browser-owned WebGL operations
// are replaced. Tests may pass a real controlled GL port for negative paths.
export function createRenderDeviceFixture({
  gl = null, canvas = null, version = 2, contextRevision = 1,
  maxTextureSize = 4096, stencil = false, extensions = [],
} = {}) {
  const context = gl || {
    MAX_TEXTURE_SIZE: 0x0d33,
    getParameter(parameter) { return parameter === this.MAX_TEXTURE_SIZE ? maxTextureSize : 0; },
    getContextAttributes() { return { stencil }; },
    getExtension(name) { return extensions.includes(name) ? {} : null; },
  };
  const owner = canvas || { getContext: () => context };
  const device = createRenderDevice({ gl: context, canvas: owner, version, contextRevision });
  if (!isRenderDevice(device)) throw Error('Test RenderDevice did not satisfy the current contract');
  return { gl: context, canvas: owner, device };
}
