import { sharedCalculationCore } from './temporal.js';

/** The shared kernel owns retry classification, precision and original errors. */
export function clippingOperationWithPrecisionRetry(method, ...inputs) {
  return sharedCalculationCore.polygonOperation(method, inputs, true);
}
