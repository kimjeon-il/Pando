import { sharedCalculationCore } from "../document/temporal.js";
import { DEFAULT_PLACE_LANGUAGES } from "../document/place-contract.js";
import { temporalMonthEnd } from "../document/temporal.js";

/** Shared period projection. No evidence exists here for builtin places in BCE. */
export function placeLabelRowsAtMonth(place, month, languages = DEFAULT_PLACE_LANGUAGES) {
  if (String(month || '').startsWith('-')) return [];
  const date = typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) ? temporalMonthEnd(month).canonical : null;
  return resolvePlaceLabelRows(place, languages, date);
}

/** Select period-appropriate names, then suppress duplicate visual text across all languages. */
export function resolvePlaceLabelRows(place, languages = DEFAULT_PLACE_LANGUAGES, mapDate = null,
  sourceReferenceDate = new Date().toISOString().slice(0, 10)) {
  if (mapDate != null && !/^\d{4}-\d{2}-\d{2}$/u.test(mapDate)) throw new TypeError('Invalid map label date');
  if (typeof sharedCalculationCore.placeNameRows !== 'function') throw new Error('Required place naming capability is unavailable');
  const rows = [], seen = new Set();
  const add = (language, value, modernName) => {
    const name = String(value || '').trim(), key = name.normalize('NFKC').toLocaleLowerCase();
    if (name && !seen.has(key)) { seen.add(key); rows.push(Object.freeze({ language,
      text: (modernName ? '(현)' : '') + name, modernName })); }
  };
  for (const row of sharedCalculationCore.placeNameRows(place, languages || {}, mapDate || '', sourceReferenceDate)) {
    add(row.language, row.text, row.modernName);
  }
  return rows;
}

/** Map-only presentation: Korean is mandatory; a verified native primary may supplement it at 8x.
 * English and additional co-official names remain in the source/search/detail data.
 * Secondary rows are optional: collision layout may omit them without removing Korean.
 */
export const PLACE_NATIVE_LABEL_MIN_ZOOM = 8;

export function mapPlaceLabelRowsAtMonth(place, month, { zoom = 0, showNativeNames = false } = {}) {
  const rows = placeLabelRowsAtMonth(place, month, { ko: true });
  if (!rows.length || !showNativeNames || zoom < PLACE_NATIVE_LABEL_MIN_ZOOM)
    return { rows, secondaryRows: [] };

  // Query native-only so that a native name identical to Korean never causes
  // the second co-official name to take the primary native's place.
  const primaryNative = placeLabelRowsAtMonth(place, month, { native: true })[0];
  const normalized = text => String(text || '').replace(/^\\(현\\)/u, '')
    .normalize('NFKC').toLocaleLowerCase();
  const duplicate = rows.some(row => normalized(row.text) === normalized(primaryNative?.text));
  return { rows, secondaryRows: primaryNative && !duplicate ? [primaryNative] : [] };
}
