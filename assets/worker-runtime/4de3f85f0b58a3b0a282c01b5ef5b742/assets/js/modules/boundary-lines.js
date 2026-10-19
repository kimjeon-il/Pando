import { sharedCalculationCore } from './temporal.js';

// P5-5: no independent JS graph walk. The shared C++ kernel preserves the
// owner's input order, junction stops and dash-chain continuity for Web/WASM.
// Qt links the same pandoeditor_core without a JavaScript boundary fallback.
if (typeof sharedCalculationCore?.boundaryConnectChains !== 'function') {
  throw Object.assign(new Error('Shared C++ boundary-chain calculation is unavailable.'),
    { code: 'PL-CORE-WASM-CAPABILITY' });
}

export function connectBoundarySegments(segments) {
  return sharedCalculationCore.boundaryConnectChains(segments);
}
