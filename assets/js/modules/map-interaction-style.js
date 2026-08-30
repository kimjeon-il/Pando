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

export function resolveMapInteractionStyle({
  theme = 'dark',
  selectionColor = '#346733',
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
  const resolvedSelectionColor = color(selectionColor, '#346733');
  const casingColor = color(tokens.textStrong, dark ? '#f2f4f6' : '#1c2229');
  const hoverColor = color(dark ? tokens.accent2 : tokens.accent, dark ? '#e2c982' : '#315e9d');
  return Object.freeze({
    theme: resolvedTheme,
    hover: Object.freeze({ color: hoverColor, width: 1.5, alpha: 1, fillAlpha: dark ? 0.07 : 0.06 }),
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
