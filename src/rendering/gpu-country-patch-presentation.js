export function createCountryPatchPresentation() {
  let current = null;

  function begin({ eligible, ids, token, geometryRevision, previousBaseResult = null }) {
    current = eligible ? {
      mode: 'preserve-existing-scene', phase: 'waiting-mesh', ids: new Set(ids),
      token, geometryRevision, previousBaseResult, heldFrameCount: 0,
    } : null;
    return ticket();
  }

  function matches(token, geometryRevision) {
    return current?.token === token && current.geometryRevision === geometryRevision;
  }

  function stage(token, geometryRevision) {
    if (!matches(token, geometryRevision)) return false;
    current.phase = 'staging';
    return true;
  }

  function setIds(token, ids) {
    if (current?.token !== token) return false;
    current.ids = new Set(ids);
    return true;
  }

  function shouldHold({ geometryRevision, canComposite, terrainAvailable,
    targetTileCount, loadedTileCount, terrainSettled }) {
    return !!current && current.phase === 'staging' && current.preserveAllowed !== false
      && current.geometryRevision === geometryRevision && canComposite && terrainAvailable
      && targetTileCount > 0 && loadedTileCount < targetTileCount && !terrainSettled;
  }

  function heldBaseResult() {
    if (current?.phase !== 'staging') return null;
    current.heldFrameCount += 1;
    return current.previousBaseResult;
  }

  function promote(token, geometryRevision) {
    if (!matches(token, geometryRevision) || current.phase !== 'staging') return false;
    current.phase = 'promoted';
    return true;
  }

  function snapshot() {
    return current ? { mode: current.mode, phase: current.phase,
      geometryRevision: current.geometryRevision, heldFrameCount: current.heldFrameCount } : null;
  }

  function ticket() {
    return current ? Object.freeze({ ...current, ids: Object.freeze([...current.ids]) }) : null;
  }

  return Object.freeze({
    begin, stage, setIds, shouldHold, heldBaseResult, promote, snapshot,
    current: ticket, matches,
    phase: () => current?.phase || null,
    canDrawOverride: id => current?.phase === 'staging' && current.ids.has(String(id)),
    preservesScene: signaturesEqual => !!current && ['waiting-mesh', 'staging', 'promoted'].includes(current.phase)
      && current.preserveAllowed !== false && signaturesEqual(),
    disablePreservation: () => { if (current) current.preserveAllowed = false; },
    clearIfToken: token => { if (current?.token !== token) return false; current = null; return true; },
    retirePromoted: () => { if (current?.phase === 'promoted') current = null; },
    clear: () => { current = null; },
  });
}
