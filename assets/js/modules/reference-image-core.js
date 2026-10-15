import { sharedCalculationCore } from './temporal.js';

if (typeof sharedCalculationCore.referenceImageCalculate !== 'function') {
  throw Object.assign(new Error('Required compiled reference image capability is unavailable.'),
    { code: 'PL-CORE-WASM-CAPABILITY' });
}

export function calculateReferenceImage(operation, input) {
  // Preserve invalid numeric input through JSON transport: NaN/Infinity must
  // remain invalid rather than becoming null (which numeric coercion treats as 0).
  const encoded = JSON.stringify(input, (_key, value) =>
    typeof value === 'number' && !Number.isFinite(value) ? String(value) : value);
  return JSON.parse(sharedCalculationCore.referenceImageCalculate(operation, encoded));
}

export function calculateReferencePlacement(operation, input, project, unproject) {
  return sharedCalculationCore.referenceImagePlacement(operation, input, project, unproject);
}

const descriptors = new WeakMap();
export function freezeReferenceResult(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeReferenceResult(child);
  return Object.freeze(value);
}
export function referenceWarpDescriptor(warp) {
  return descriptors.get(warp?.project) ?? null;
}

export function createReferenceWarp(descriptor) {
  freezeReferenceResult(descriptor);
  if (!descriptor.ok) return descriptor;
  const { xCoefficients, yCoefficients, ...publicFields } = descriptor;
  const project = point => {
    const result = calculateReferenceImage('project', { warp: descriptor, point });
    return result ? Object.freeze(result) : null;
  };
  descriptors.set(project, descriptor);
  return Object.freeze({ ...publicFields, project });
}
