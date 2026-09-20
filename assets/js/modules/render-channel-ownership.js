const SCENE_RENDERERS = new Set(['webgl2', 'webgl1', 'canvas-worker', 'canvas2d']);

export function rendererOwnsSceneGeometry(renderer) {
  return SCENE_RENDERERS.has(String(renderer || ''));
}

export function makeSvgSceneProxy(node) {
  if (!node?.style) return false;
  node.classList?.add('gpu-scene-hit-proxy');
  node.style.setProperty('fill', 'transparent');
  node.style.setProperty('fill-opacity', '0');
  node.style.setProperty('stroke', 'transparent');
  node.style.setProperty('stroke-opacity', '0');
  node.style.setProperty('filter', 'none');
  node.style.setProperty('mix-blend-mode', 'normal');
  return true;
}
