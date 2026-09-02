export const GPU_VIEW_UNIFORM_NAMES = Object.freeze([
  'uViewport', 'uTranslate', 'uScale', 'uRowX', 'uRowY', 'uRowZ', 'uFlatCenter', 'uWorldOffset', 'uMode',
]);

export function setGpuViewUniforms(gl, {
  frameContext,
  worldOffset = 0,
  getLocation,
} = {}) {
  if (!gl || !frameContext || typeof getLocation !== 'function') return false;
  const location = name => getLocation(name);
  gl.uniform2f(location('uViewport'), frameContext.viewport[0], frameContext.viewport[1]);
  gl.uniform2f(location('uTranslate'), frameContext.translate[0], frameContext.translate[1]);
  gl.uniform1f(location('uScale'), frameContext.scale);
  gl.uniform3fv(location('uRowX'), frameContext.rowX);
  gl.uniform3fv(location('uRowY'), frameContext.rowY);
  gl.uniform3fv(location('uRowZ'), frameContext.rowZ);
  gl.uniform2f(location('uFlatCenter'), frameContext.flatCenter[0], frameContext.flatCenter[1]);
  gl.uniform1f(location('uWorldOffset'), worldOffset);
  gl.uniform1i(location('uMode'), frameContext.mode);
  return true;
}
