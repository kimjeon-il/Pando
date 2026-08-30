const THEMES = new Set(['light', 'dark']);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function color(value, fallback) {
  const normalized = String(value || '').trim();
  return COLOR_PATTERN.test(normalized) ? normalized.toLowerCase() : fallback;
}

function unitInterval(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function mixWithWhite(value, amount = 0.2) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
  if (!match) return value;
  const numeric = Number.parseInt(match[1], 16);
  const ratio = unitInterval(amount, 0.2);
  const channels = [(numeric >> 16) & 255, (numeric >> 8) & 255, numeric & 255];
  return `#${channels.map(channel => Math.round(channel * (1 - ratio) + 255 * ratio)
    .toString(16).padStart(2, '0')).join('')}`;
}

export function resolveMapInteractionStyle({
  theme = 'dark',
  selectionColor = null,
  outlineVisible = true,
  fillStrength = 0.35,
  tokens = {},
} = {}) {
  const resolvedTheme = THEMES.has(theme) ? theme : 'dark';
  const dark = resolvedTheme === 'dark';
  const resolvedFillStrength = unitInterval(fillStrength, 0.35);
  const resolvedOutlineVisible = outlineVisible !== false;
  const maxFill = dark ? { primary: 0.30, secondary: 0.18 } : { primary: 0.24, secondary: 0.14 };
  const fill = {
    primary: maxFill.primary * resolvedFillStrength,
    secondary: maxFill.secondary * resolvedFillStrength,
  };
  const themeAccentFallback = dark ? '#cda95d' : '#315e9d';
  const resolvedSelectionColor = color(selectionColor, color(tokens.accent, themeAccentFallback));
  const casingColor = color(tokens.textStrong, dark ? '#f2f4f6' : '#1c2229');
  const hoverColor = mixWithWhite(resolvedSelectionColor, 0.2);
  const hoverFillAlpha = Math.max(0.05, Math.min(0.10, fill.primary * 0.55));
  return Object.freeze({
    theme: resolvedTheme,
    hover: Object.freeze({ color: hoverColor, width: 1.5, alpha: 1, fillAlpha: hoverFillAlpha }),
    selection: Object.freeze({
      color: resolvedSelectionColor,
      casingColor,
      outlineVisible: resolvedOutlineVisible,
      fillStrength: resolvedFillStrength,
      primary: Object.freeze({
        innerWidth: resolvedOutlineVisible ? 2.5 : 0,
        innerAlpha: resolvedOutlineVisible ? 1 : 0,
        outerWidth: resolvedOutlineVisible ? 4 : 0,
        casingAlpha: resolvedOutlineVisible ? (dark ? 0.72 : 0.64) : 0,
        fillAlpha: fill.primary,
      }),
      secondary: Object.freeze({
        innerWidth: resolvedOutlineVisible ? 1.5 : 0,
        innerAlpha: resolvedOutlineVisible ? 0.72 : 0,
        outerWidth: resolvedOutlineVisible ? 2.8 : 0,
        casingAlpha: resolvedOutlineVisible ? (dark ? 0.48 : 0.42) : 0,
        fillAlpha: fill.secondary,
      }),
    }),
    drawOrder: Object.freeze(['hover', 'secondary-casing', 'secondary-inner', 'primary-casing', 'primary-inner']),
  });
}
