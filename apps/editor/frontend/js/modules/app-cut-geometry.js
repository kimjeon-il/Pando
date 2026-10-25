import { normalizeClippedPolygonGeometry } from "../../../../../shared/frontend/js/modules/map-edit-geometry.js";
import { sharedCalculationCore } from "../../../../../shared/frontend/js/modules/temporal.js";
import { preparedCut } from './cut-preparation-cache.js';
import { coordinateBounds } from "../../../../../shared/frontend/js/modules/coordinate-bounds.js";

// UI consumes the worker's prepared result; it never rebuilds a cut graph.
export function createCutGeometry() {
  let dependencies;
  function connect(ports) {
    if (dependencies) throw new Error('cut-geometry already connected');
    dependencies = ports;
  }
  function activeCutDraftSourceGeometry() {
    if (dependencies.projectState.state.tool === 'split-generic-feature') {
      return dependencies.projectState.state.genericFeatures.find(item => String(item.id) === String(dependencies.projectState.state.genericFeatureSplitSourceId))?.geometry || null;
    }
    if (dependencies.projectState.state.tool === 'split-territorial-unit') {
      return (dependencies.territorialModel.entityRepository.get(dependencies.projectState.state.territorialUnitSplitSourceId) || dependencies.projectState.state.territorialUnitSplitVirtualSource)?.geometry || null;
    }
    const territorySelection = dependencies.projectState.state.territorySelectionSession;
    if (territorySelection?.tool === dependencies.projectState.state.tool && territorySelection.stage === 'selection'
      && territorySelection.activePhase === 'drawing' && territorySelection.activeMethod === 'line') return territorySelection.workingSourceGeometry || null;
    return null;
  }


  function assessCutDraft(line, source) {
    return preparedCut(source, line) || { line, snaps: { start: null, end: null },
      status: 'pending', valid: false, message: '경계선을 계산하는 중입니다.', issues: [] };
  }
  function buildCutSplitCandidates(source, line) {
    const result = preparedCut(source, line);
    if (result?.split) return result.split;
    throw new Error(result?.splitError || '최신 경계선의 계산이 끝난 뒤 다시 시도하세요.');
  }
  function segmentIntersectionDetail(a, b, c, d, epsilon = 1e-10) {
    return JSON.parse(sharedCalculationCore.cutSegmentIntersection(JSON.stringify([a, b, c, d, epsilon])));
  }
  return Object.freeze({ connect, activeCutDraftSourceGeometry, assessCutDraft, buildCutSplitCandidates,
    coordinateBounds, normalizeClippedLandGeometry: normalizeClippedPolygonGeometry,
    boundsOverlap: (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1],
    segmentIntersectionDetail });
}
