const contexts = new WeakMap();
const TOKEN_NAMES = ['accent', 'accent-2', 'accent-surface', 'accent-surface-hover', 'accent-border', 'accent-text', 'focus-ring'];
const channels = hex => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
const mix = (hex, amount) => `#${channels(hex).map(value => Math.round(value * (1 - amount)).toString(16).padStart(2, '0')).join('')}`;

export function accentTokens(hex) {
  const luminance = channels(hex).map(value => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  return {
    accent: hex, 'accent-2': hex, 'accent-surface': hex,
    'accent-surface-hover': mix(hex, 0.1), 'accent-border': mix(hex, 0.08),
    'accent-text': (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff',
    'focus-ring': `${hex}6b`,
  };
}

// Resolve CSS colors once per appearance change, never in a map render loop.
export function applyAppAccent(documentRef, hex = null) {
  const root = documentRef.documentElement;
  for (const name of TOKEN_NAMES) root.style.removeProperty(`--ui-v2-color-${name}`);
  if (hex) {
    for (const [name, value] of Object.entries(accentTokens(hex))) root.style.setProperty(`--ui-v2-color-${name}`, value);
    return hex;
  }
  const cssColor = documentRef.defaultView.getComputedStyle(root).getPropertyValue('--accent').trim();
  if (/^#[0-9a-f]{6}$/i.test(cssColor)) return cssColor.toLowerCase();
  let context = contexts.get(documentRef);
  if (!context) {
    const canvas = documentRef.createElement('canvas'); canvas.width = canvas.height = 1;
    context = canvas.getContext('2d', { willReadFrequently: true });
    if (context) contexts.set(documentRef, context);
  }
  if (!context) return root.dataset.theme === 'dark' ? '#4f8cff' : '#315e9d';
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = cssColor;
  context.fillRect(0, 0, 1, 1);
  return `#${Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('')}`;
}
