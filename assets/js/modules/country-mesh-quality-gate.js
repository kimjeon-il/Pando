/**
 * A precise country override may only be composited after the base country
 * mesh has reached the same quality.  Canvas owns one mesh, so it does not
 * need this gate.
 */
export function decideCountryPatchPresentation({ renderer, canonicalMeshReady, ids = [] } = {}) {
  const normalizedIds = [...new Set((ids || []).map(String).filter(Boolean))];
  return {
    mode: /^webgl/.test(String(renderer || '')) && !canonicalMeshReady ? 'defer' : 'install',
    ids: normalizedIds,
  };
}
