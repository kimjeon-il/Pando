// Extracted calculation/data contract; not part of the shipped Viewer runtime.
import { sharedCalculationCore } from "../../src/document/temporal.js";

/** The shared kernel owns retry classification, precision and original errors. */
export function clippingOperationWithPrecisionRetry(method, ...inputs) {
  return sharedCalculationCore.polygonOperation(method, inputs, true);
}
