const THEMES = new Set(['light', 'dark']);
const MODES = new Set(['outline', 'outline-soft-fill', 'strong-fill']);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function color(value, fallback) {
  const normalized = String(value || '').trim();
  return COLOR_PATTERN.test(normalized) ? normalized.toLowerCase() : fallback;
}

export function resolveMapInteractionStyle({
  theme = 'dark',
  selectionColor = '#346733',
  selectionMode = 'outline-soft-fill',
  tokens = {},
} = {}) {
  const resolvedTheme = THEMES.has(theme) ? theme : 'dark';
  const resolvedMode = MODES.has(selectionMode) ? selectionMode : 'outline-soft-fill';
  const dark = resolvedTheme === 'dark';
  const fill = resolvedMode === 'outline'
    ? { primary: 0, secondary: 0 }
    : resolvedMode === 'strong-fill'
      ? (dark ? { primary: 0.30, secondary: 0.18 } : { primary: 0.24, secondary: 0.14 })
      : (dark ? { primary: 0.13, secondary: 0.08 } : { primary: 0.10, secondary: 0.06 });
  const resolvedSelectionColor = color(selectionColor, '#346733');
  const casingColor = color(tokens.textStrong, dark ? '#f2f4f6' : '#1c2229');
  const hoverColor = color(
    dark ? tokens.accent2 : tokens.accent,
    dark ? '#e2c982' : '#315e9d',
  );
  return Object.freeze({
    theme: resolvedTheme,
    selectionMode: resolvedMode,
    hover: Object.freeze({
      color: hoverColor,
      width: 1.5,
      alpha: 1,
      fillAlpha: dark ? 0.07 : 0.06,
    }),
    selection: Object.freeze({
      color: resolvedSelectionColor,
      casingColor,
      primary: Object.freeze({
        innerWidth: 2.5,
        innerAlpha: 1,
        outerWidth: 4,
        casingAlpha: dark ? 0.72 : 0.64,
        fillAlpha: fill.primary,
      }),
      secondary: Object.freeze({
        innerWidth: 1.5,
        innerAlpha: 0.72,
        outerWidth: 2.8,
        casingAlpha: dark ? 0.48 : 0.42,
        fillAlpha: fill.secondary,
      }),
    }),
    drawOrder: Object.freeze([
      'hover',
      'secondary-casing',
      'secondary-inner',
      'primary-casing',
      'primary-inner',
    ]),
  });
}

