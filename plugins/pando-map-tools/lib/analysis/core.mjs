import { core as sharedCalculationCore } from '../workspace.mjs';

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

function exposeReferenceWarp(descriptor, prepared) {
  freezeReferenceResult(descriptor);
  if (!descriptor.ok) { prepared.delete(); return descriptor; }
  const { xCoefficients, yCoefficients, ...publicFields } = descriptor;
  const project = point => {
    const result = prepared.project(encodeInput(point ?? null));
    return result ? Object.freeze(result) : null;
  };
  descriptors.set(project, descriptor);
  preparedWarps.set(project, prepared);
  releaseWarps.register(project, prepared);
  return Object.freeze({ ...publicFields, project });
}

export function createReferenceWarp(descriptor) {
  if (!descriptor.ok) return freezeReferenceResult(descriptor);
  return exposeReferenceWarp(descriptor,
    new sharedCalculationCore.PreparedReferenceImageWarp(encodeInput(descriptor)));
}

export function createCalculatedReferenceWarp(operation, input) {
  // Calculate and prepare in the same C++ call. Do not serialize the complete
  // result back into WASM just to recover coefficients it already owns.
  const prepared = new sharedCalculationCore.PreparedReferenceImageWarp(operation, encodeInput(input));
  try {
    return exposeReferenceWarp(JSON.parse(prepared.takeDescriptor()), prepared);
  } catch (error) {
    prepared.delete();
    throw error;
  }
}

// UVs and connectivity depend only on the dimensions returned by the engine.
// Retain a small set of immutable C++-generated layouts; coordinates remain
// unique to each warp. No JS triangulation or coordinate calculation is added.
const meshLayouts = new Map();
function meshLayout(packet) {
  const key = packet.columns + ':' + packet.rows;
  let layout = meshLayouts.get(key);
  if (layout) return layout;
  const uv = new Array(packet.vertices.length / 4), triangles = new Array(packet.triangles.length / 3);
  for (let i = 0; i < uv.length; i++) uv[i] = Object.freeze([packet.vertices[i * 4], packet.vertices[i * 4 + 1]]);
  for (let i = 0; i < triangles.length; i++) triangles[i] = Object.freeze([
    packet.triangles[i * 3], packet.triangles[i * 3 + 1], packet.triangles[i * 3 + 2]]);
  layout = { uv: Object.freeze(uv), triangles: Object.freeze(triangles) };
  if (meshLayouts.size >= 8) meshLayouts.delete(meshLayouts.keys().next().value);
  meshLayouts.set(key, layout);
  return layout;
}

export function calculateReferenceMesh(warp, columns, rows) {
  const prepared = preparedWarps.get(warp.project);
  if (!prepared) throw new TypeError('A shared reference warp is required.');
  const packet = prepared.mesh(Number(columns), Number(rows));
  if (!packet) return null;
  const layout = meshLayout(packet), values = packet.vertices;
  const vertices = new Array(layout.uv.length);
  for (let i = 0; i < vertices.length; i++) {
    const offset = i * 4;
    vertices[i] = Object.freeze({ uv: layout.uv[i], coordinate: Number.isFinite(values[offset + 2])
      ? Object.freeze([values[offset + 2], values[offset + 3]]) : null });
  }
  return Object.freeze({ columns: packet.columns, rows: packet.rows,
    vertices: Object.freeze(vertices), triangles: layout.triangles });
}
