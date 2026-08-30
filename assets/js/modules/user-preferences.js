const STORAGE_KEY = 'pandolab-user-preferences';
const DEFAULTS = Object.freeze({
  version: 1,
  appearance: Object.freeze({ theme: 'system' }),
  selection: Object.freeze({ mode: 'outline-soft-fill', color: '#346733' }),
});

const THEMES = new Set(['system', 'light', 'dark']);
const SELECTION_MODES = new Set(['outline', 'outline-soft-fill', 'strong-fill']);

function normalizeColor(value, fallback) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

export function defaultUserPreferences() {
  return { version: 1, appearance: { theme: 'system' }, selection: { mode: DEFAULTS.selection.mode, color: DEFAULTS.selection.color } };
}

export function normalizeUserPreferences(value) {
  const defaults = defaultUserPreferences();
  const source = value && typeof value === 'object' ? value : {};
  const theme = THEMES.has(source.appearance?.theme) ? source.appearance.theme : defaults.appearance.theme;
  const mode = SELECTION_MODES.has(source.selection?.mode) ? source.selection.mode : defaults.selection.mode;
  return { version: 1, appearance: { theme }, selection: { mode, color: normalizeColor(source.selection?.color, defaults.selection.color) } };
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

export { STORAGE_KEY, DEFAULTS };
