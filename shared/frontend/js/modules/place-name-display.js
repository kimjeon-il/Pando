import { sharedCalculationCore } from './temporal.js';
import { DEFAULT_PLACE_LANGUAGES } from './place-contract.js';
import { temporalMonthEnd } from './temporal.js';

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
