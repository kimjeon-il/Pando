export const ACCENT_PRESETS = Object.freeze({
  red: Object.freeze({ light: '#d43d45', dark: '#ff7078' }),
  orange: Object.freeze({ light: '#dc781d', dark: '#f4a24c' }),
  green: Object.freeze({ light: '#2c9857', dark: '#58c97f' }),
  teal: Object.freeze({ light: '#168f8b', dark: '#3ac5bb' }),
  blue: Object.freeze({ light: '#316fd3', dark: '#70a6ff' }),
  purple: Object.freeze({ light: '#7856d6', dark: '#ad8cff' }),
  pink: Object.freeze({ light: '#cc4b83', dark: '#ef78ab' }),
});

export const ACCENT_PRESET_IDS = Object.freeze(Object.keys(ACCENT_PRESETS));
const LEGACY_PRESETS = Object.freeze({
  '#dc2626': 'red', '#e87924': 'orange', '#2e9d57': 'green', '#0f9d92': 'teal',
  '#4f8cff': 'blue', '#8b5cf6': 'purple', '#d9468f': 'pink',
});

export function resolveAccentPreset(preset, theme = 'light') {
  return ACCENT_PRESETS[preset]?.[theme === 'dark' ? 'dark' : 'light'] || null;
}

export function accentPresetForColor(value) {
  const color = String(value || '').trim().toLowerCase();
  if (LEGACY_PRESETS[color]) return LEGACY_PRESETS[color];
  for (const [preset, colors] of Object.entries(ACCENT_PRESETS)) {
    if (color === colors.light || color === colors.dark) return preset;
  }
  return null;
}
