const STORAGE_KEY = 'pandolab-user-preferences';

const THEMES = new Set(['system', 'light', 'dark']);
const LABEL_FONTS = new Set(['default', 'gothic', 'serif']);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const DEFAULTS = Object.freeze({
  version: 2,
  appearance: Object.freeze({ theme: 'system', accentColor: null }),
  labels: Object.freeze({
    country: Object.freeze({ font: 'default', color: null }),
    place: Object.freeze({ font: 'default', color: null, pointColor: null }),
  }),
  selection: Object.freeze({ color: null, outlineVisible: true, fillStrength: 0.35 }),
});

function normalizeColor(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const text = String(value).trim();
  return COLOR_PATTERN.test(text) ? text.toLowerCase() : fallback;
}

function normalizeFillStrength(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function normalizeLabelFont(value, fallback) {
  return LABEL_FONTS.has(value) ? value : fallback;
}

export function defaultUserPreferences() {
  return {
    version: DEFAULTS.version,
    appearance: { theme: DEFAULTS.appearance.theme, accentColor: null },
    labels: {
      country: { font: DEFAULTS.labels.country.font, color: DEFAULTS.labels.country.color },
      place: {
        font: DEFAULTS.labels.place.font,
        color: DEFAULTS.labels.place.color,
        pointColor: DEFAULTS.labels.place.pointColor,
      },
    },
    selection: {
      color: DEFAULTS.selection.color,
      outlineVisible: DEFAULTS.selection.outlineVisible,
      fillStrength: DEFAULTS.selection.fillStrength,
    },
  };
}

export function normalizeUserPreferences(value) {
  const defaults = defaultUserPreferences();
  const source = value && typeof value === 'object' && Number(value.version) === DEFAULTS.version ? value : {};
  const theme = THEMES.has(source.appearance?.theme) ? source.appearance.theme : defaults.appearance.theme;
  const fillStrength = normalizeFillStrength(source.selection?.fillStrength, defaults.selection.fillStrength);
  const outlineVisible = source.selection?.outlineVisible !== false || fillStrength === 0;
  return {
    version: DEFAULTS.version,
    appearance: { theme, accentColor: normalizeColor(source.appearance?.accentColor) },
    labels: {
      country: {
        font: normalizeLabelFont(source.labels?.country?.font, defaults.labels.country.font),
        color: normalizeColor(source.labels?.country?.color),
      },
      place: {
        font: normalizeLabelFont(source.labels?.place?.font, defaults.labels.place.font),
        color: normalizeColor(source.labels?.place?.color),
        pointColor: normalizeColor(source.labels?.place?.pointColor),
      },
    },
    selection: {
      color: normalizeColor(source.selection?.color, defaults.selection.color),
      outlineVisible,
      fillStrength,
    },
  };
}

export function loadUserPreferences(storage = globalThis.localStorage) {
  try { return normalizeUserPreferences(JSON.parse(storage?.getItem(STORAGE_KEY) || 'null')); }
  catch (_) { return defaultUserPreferences(); }
}

export function saveUserPreferences(value, storage = globalThis.localStorage) {
  const normalized = normalizeUserPreferences(value);
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(normalized)); } catch (_) { /* private mode */ }
  return normalized;
}

export function effectiveTheme(preference, prefersDark = false) {
  const theme = normalizeUserPreferences(preference).appearance.theme;
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
}

export { STORAGE_KEY };
