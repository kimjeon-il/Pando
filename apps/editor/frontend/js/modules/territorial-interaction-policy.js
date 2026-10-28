import { sharedCalculationCore } from '../../../../../shared/frontend/js/modules/temporal.js';

export function subunitSelectionPolicy(units, { deferConnectivity = false, locked = unit => unit.properties?.locked } = {}) {
  if (typeof sharedCalculationCore.subunitSelectionDecision !== 'function') {
    throw Object.assign(new Error('Canonical C++ subunit selection validator is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  const { status: decision } = sharedCalculationCore.subunitSelectionDecision(
    units.map(unit => typeof unit?.properties?.entityKind === 'string' ? unit.properties.entityKind : ''),
    units.map(unit => unit?.properties?.parentId ? String(unit.properties.parentId) : ''),
    units.map(unit => unit ? !!locked(unit) : false),
    units.map(unit => unit?.geometry?.type === 'Polygon' ? [unit.geometry.coordinates || []] : unit?.geometry?.coordinates || []),
    deferConnectivity,
  );
  const messages = {
    'invalid-selection': '하위단위를 2개 이상 선택하세요.',
    'different-parent': '같은 소속 국가·상위 단위의 하위단위만 함께 편집할 수 있습니다.',
    locked: '선택한 하위단위의 잠금을 해제하세요.',
    disconnected: '선택한 하위단위들이 공유 경계로 연결되어야 합니다.',
    valid: '선택한 하위단위 사이의 공유 경계를 편집합니다.',
  };
  if (!Object.hasOwn(messages, decision)) throw new Error('Unknown C++ subunit selection result.');
  return { valid: decision === 'valid', message: messages[decision] };
}

export function boundaryTouchesGeometry(geometry, point, epsilon = 1e-7) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.coordinates || [];
  return polygons.some(polygon => polygon.some(ring => ring.some((b, index) => {
    if (!index) return false;
    const a = ring[index - 1], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    if (!length) return false;
    const t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (length * length);
    return t >= -epsilon && t <= 1 + epsilon && Math.abs(dx * (point[1] - a[1]) - dy * (point[0] - a[0])) / length <= epsilon;
  })));
}
