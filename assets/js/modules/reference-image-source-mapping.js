import { buildReferenceImageCalibrationWarp } from './reference-image-georef.js';
import { createCalculatedReferenceWarp } from './reference-image-core.js';

export function buildReferenceImageSourceMapping(record = {}) {
  const calibration = buildReferenceImageCalibrationWarp({
    controlPoints: record.controlPoints,
    anchor: record.anchor,
    cornerPinEnabled: record.cornerPinEnabled,
    mapQuad: record.mapQuad,
    mode: record.warpMode,
  });
  if (calibration.ok) return calibration;

  if (!record.cornerPinEnabled) return calibration;

  // Keep projection and mesh attached to the same prepared C++ warp, including
  // placement flips and UV bounds. A JS project wrapper loses that ownership.
  const placement = createCalculatedReferenceWarp('placementWarp', {
    mapQuad: record.mapQuad, flipX: record.flipX, flipY: record.flipY,
  });
  if (!placement.ok) return calibration;

  return Object.freeze({
    ...placement,
    source: 'corner-pin',
  });
}
