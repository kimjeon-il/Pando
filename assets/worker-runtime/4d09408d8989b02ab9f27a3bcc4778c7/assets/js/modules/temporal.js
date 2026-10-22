// P5-3: adapter only. The shared C++ core owns calendars, signed years,
// month boundaries, comparisons and validity. No JavaScript calendar fallback.
const required = [
  'temporalParse', 'temporalMonthEnd', 'temporalCompare', 'temporalCompareKeys',
  'temporalNormalizeInterval', 'temporalContains', 'temporalIntervalsOverlap',
  'temporalShiftMonth', 'temporalFollowingDay',
];
const core = await (async () => {
  if (globalThis.PandoLabSphericalCore) return globalThis.PandoLabSphericalCore;
  if (globalThis.process?.versions?.node) {
    const { loadNodeCore } = await import('../../../tools/load-node-core.mjs');
    return loadNodeCore();
  }
  const { loadVerifiedCore } = await import('./core-wasm-loader.js');
  return loadVerifiedCore({ baseUrl: new URL("../../../../../wasm/", import.meta.url) });
})();
globalThis.PandoLabSphericalCore = core;
for (const name of required) {
  if (typeof core?.[name] !== 'function') {
    throw Object.assign(new Error('Required compiled temporal capability is unavailable: ' + name),
      { code: 'PL-CORE-WASM-CAPABILITY' });
  }
}

// The verified compiled module is shared by temporal and timeline adapters.
export const sharedCalculationCore = core;

const text = value => String(value ?? '').trim();
const messages = Object.freeze({
  format: 'YYYY, YYYY-MM 또는 YYYY-MM-DD 형식을 사용하세요.',
  'extended year needs sign': '확장 연도는 + 또는 - 부호가 필요합니다.',
  'year zero': '연도 0은 사용할 수 없습니다. -0001 다음은 0001입니다.',
  month: '월은 01~12여야 합니다.',
  day: '해당 월에 존재하지 않는 날짜입니다.',
  'month precision required': '월 단위 값이 필요합니다.',
  'year out of range': '지원하지 않는 연도 범위입니다.',
});
function temporalError(value, message) {
  const error = new Error('날짜 ' + (text(value) || '(없음)') + '이(가) 올바르지 않습니다. ' + message);
  error.code = 'PL-TEMPORAL-001';
  return error;
}
function rethrowCalendarError(error, input) {
  if (error?.code !== 'PL-TEMPORAL-001') throw error;
  const detail = String(error.message ?? '');
  const prefix = 'INVALID_DATE: ';
  const reason = detail.startsWith(prefix) ? detail.slice(prefix.length) : 'format';
  throw temporalError(input, messages[reason] || messages.format);
}
function frozenPoint(value) {
  return Object.freeze({
    source: value.source, canonical: value.canonical, precision: value.precision,
    year: value.year, month: value.month, day: value.day,
    startKey: Object.freeze([...value.startKey]),
    endKey: Object.freeze([...value.endKey]),
  });
}
const point = value => typeof value === 'object' && value?.startKey
  ? value : parseTemporal(value, { nullable: false });

export function parseTemporal(value, { nullable = true } = {}) {
  const source = text(value);
  if (!source) {
    if (nullable) return null;
    throw temporalError(value, '값이 필요합니다.');
  }
  try { return frozenPoint(core.temporalParse(source)); }
  catch (error) { rethrowCalendarError(error, value); }
}

export function normalizeTemporal(value, options) {
  return parseTemporal(value, options)?.canonical ?? null;
}

/** A timeline cursor is always resolved to the last day of its calendar month. */
export function temporalMonthEnd(value) {
  const month = point(value);
  if (month.precision !== 'month') throw temporalError(value, messages['month precision required']);
  try { return frozenPoint(core.temporalMonthEnd(month.canonical)); }
  catch (error) { rethrowCalendarError(error, value); }
}

export function compareTemporalKeys(left, right) {
  return core.temporalCompareKeys(left, right);
}

export function compareTemporal(left, right, { leftBoundary = 'start', rightBoundary = 'start' } = {}) {
  const a = point(left), b = point(right);
  const leftEnd = leftBoundary === 'end', rightEnd = rightBoundary === 'end';
  // The older event-sort interface can supply bare keys without canonical text.
  // Comparison still executes in C++, including out-of-range end sentinels.
  if (!a.canonical || !b.canonical) {
    return compareTemporalKeys(a[leftEnd ? 'endKey' : 'startKey'], b[rightEnd ? 'endKey' : 'startKey']);
  }
  return core.temporalCompare(a.canonical, b.canonical, leftEnd, rightEnd);
}

export function normalizeTemporalInterval(validFrom, validTo) {
  const start = parseTemporal(validFrom), end = parseTemporal(validTo);
  const interval = core.temporalNormalizeInterval(start?.canonical ?? null, end?.canonical ?? null);
  return Object.freeze({ validFrom: interval.validFrom, validTo: interval.validTo, start, end });
}

export function temporalContains(interval, value) {
  const when = point(value);
  const start = interval?.start || parseTemporal(interval?.validFrom);
  const end = interval?.end || parseTemporal(interval?.validTo);
  return core.temporalContains(start?.canonical ?? null, end?.canonical ?? null, when.canonical);
}

export function temporalIntervalsOverlap(left, right) {
  const startA = left?.start || parseTemporal(left?.validFrom);
  const endA = left?.end || parseTemporal(left?.validTo);
  const startB = right?.start || parseTemporal(right?.validFrom);
  const endB = right?.end || parseTemporal(right?.validTo);
  return core.temporalIntervalsOverlap(
    startA?.canonical ?? null, endA?.canonical ?? null,
    startB?.canonical ?? null, endB?.canonical ?? null);
}

export function shiftTemporalMonth(value, delta) {
  const month = point(value);
  if (month.precision !== 'month' || !Number.isInteger(delta)
    || delta < -2147483648 || delta > 2147483647)
    throw new TypeError('A month and integer offset are required.');
  try { return core.temporalShiftMonth(month.canonical, delta); }
  catch (error) { rethrowCalendarError(error, value); }
}

export function temporalFollowingDay(key) {
  return Object.freeze([...core.temporalFollowingDay(key)]);
}
