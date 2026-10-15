import { sharedCalculationCore } from './temporal.js';

if (typeof sharedCalculationCore.referenceImageCalculate !== 'function'
  || typeof sharedCalculationCore.PreparedReferenceImageWarp !== 'function') {
  throw Object.assign(new Error('Required compiled reference image capability is unavailable.'),
    { code: 'PL-CORE-WASM-CAPABILITY' });
}

function encodeInput(input) {
  // Preserve invalid numeric input through JSON transport: NaN/Infinity must
  // remain invalid rather than becoming null (which numeric coercion treats as 0).
  return JSON.stringify(input, (_key, value) =>
    typeof value === 'number' && !Number.isFinite(value) ? String(value) : value);
}

export function calculateReferenceImage(operation, input) {
  return JSON.parse(sharedCalculationCore.referenceImageCalculate(operation, encodeInput(input)));
}

export function calculateReferencePlacement(operation, input, project, unproject) {
  return sharedCalculationCore.referenceImagePlacement(operation, input, project, unproject);
}

const descriptors = new WeakMap();
const preparedWarps = new WeakMap();
// The public immutable projection closure owns one native numerical warp. It
// does not expose the handle, and releasing that closure releases its WASM data.
const releaseWarps = new FinalizationRegistry(handle => handle.delete());
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
  const prepared = new sharedCalculationCore.PreparedReferenceImageWarp(encodeInput(descriptor));
  const project = point => {
    const result = prepared.project(encodeInput(point ?? null));
    return result ? Object.freeze(result) : null;
  };
  descriptors.set(project, descriptor);
  preparedWarps.set(project, prepared);
  releaseWarps.register(project, prepared);
  return Object.freeze({ ...publicFields, project });
}

export function calculateReferenceMesh(warp, columns, rows) {
  const prepared = preparedWarps.get(warp.project);
  if (!prepared) throw new TypeError('A shared reference warp is required.');
  const packet = prepared.mesh(Number(columns), Number(rows));
  if (!packet) return null;
  // Only transport/layout happens in JS. The shared engine supplies every
  // coordinate, grid dimension and triangle index in one bounded call.
  const vertices = [], triangles = [];
  for (let i = 0; i < packet.vertices.length; i += 4) {
    vertices.push(Object.freeze({ uv: Object.freeze([packet.vertices[i], packet.vertices[i + 1]]),
      coordinate: Number.isFinite(packet.vertices[i + 2])
        ? Object.freeze([packet.vertices[i + 2], packet.vertices[i + 3]]) : null }));
  }
  for (let i = 0; i < packet.triangles.length; i += 3)
    triangles.push(Object.freeze([packet.triangles[i], packet.triangles[i + 1], packet.triangles[i + 2]]));
  return Object.freeze({ columns: packet.columns, rows: packet.rows,
    vertices: Object.freeze(vertices), triangles: Object.freeze(triangles) });
}
