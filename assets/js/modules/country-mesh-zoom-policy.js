// Screen scale is CSS pixels per radian, shared by flat and globe frames.
// Resource availability and admission of display derivatives belong to the renderer.
export function resolveCountryMeshQuality({ cssScale, previous = null, focus = false, editing = false, selected = false }) {
  if (focus || editing || selected || !Number.isFinite(cssScale) || cssScale <= 0) return 'canonical';
  if (cssScale <= 504) return 'preview';
  if (cssScale >= 642) return 'canonical';
  return previous === 'preview' ? 'preview' : 'canonical';
}
