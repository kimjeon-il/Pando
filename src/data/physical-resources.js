// Compatibility re-exports for legacy tests and build tools. The actual
// runtime map service is owned by src/rendering/physical-map-controller.js.
export {resolvePhysicalWaterObjects,physicalWaterReferenceView,composePhysicalWaterGeometry,physicalWaterContextKey} from './physical-water-model.js';
export {hydroVisibilityThresholdForMapZoom} from '../rendering/hydro-view-presentation.js';
export {createPhysicalWaterPresentation} from '../rendering/physical-water-presentation.js';
export {createPhysicalResources} from '../rendering/physical-map-controller.js';
