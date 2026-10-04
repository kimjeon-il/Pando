// The displayed quality survives projection changes in the new mode's band.
// Availability is a renderer concern: a pending load cannot change the display
// history, and project replacement resets it to preview.
export function resolveCountryMeshQuality({ projection, zoom, previous = 'preview', focus = false, editing = false }) {
  if (focus || editing) return 'canonical';
  const [lower, upper] = projection === 'globe' ? [1.8, 2.2] : [2.2, 2.8];
  if (zoom <= lower) return 'preview';
  if (zoom >= upper) return 'canonical';
  return previous === 'canonical' ? 'canonical' : 'preview';
}
