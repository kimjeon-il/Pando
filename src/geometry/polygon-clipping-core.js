// Synchronous geometry port. Runtime initialization owns loading the verified
// WASM module before any editing request; no alternate calculation is installed.
(function installPolygonCalculation(root) {
  function operation(method, operands) {
    const core = root.PandoLabSphericalCore;
    if (!core || typeof core.polygonOperation !== 'function') {
      throw Object.assign(new Error('Shared polygon calculation core is not ready'), {
        code: 'PL-GEOMETRY-CORE-NOT-READY',
      });
    }
    return core.polygonOperation(method, operands, false);
  }
  root.polygonClipping = Object.freeze({
    union: (...operands) => operation('union', operands),
    difference: (...operands) => operation('difference', operands),
    intersection: (...operands) => operation('intersection', operands),
    xor: (...operands) => operation('xor', operands),
  });
})(globalThis);
