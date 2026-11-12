// UI accent follows the browser-exposed platform AccentColor when available.
// Browsers can deliberately return a generic color to prevent fingerprinting.
const FALLBACK_ACCENTS = Object.freeze({ light: '#316fd3', dark: '#70a6ff' });
const channels = hex => [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
const mix = (hex, amount) => '#' + channels(hex).map(value => Math.round(value * (1 - amount)).toString(16).padStart(2, '0')).join('');
const linear = channel => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const contrastText = hex => {
  const [r, g, b] = channels(hex).map(linear);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05 / (luminance + 0.05)) >= ((luminance + 0.05) / 0.05) ? '#ffffff' : '#000000';
};

export function accentTokens(hex) {
  return {
    accent: hex, 'accent-2': hex, 'accent-surface': hex,
    'accent-surface-hover': mix(hex, 0.1), 'accent-border': mix(hex, 0.08),
    'accent-text': contrastText(hex),
    'focus-ring': hex + '6b',
  };
}

export function parseSystemAccentColor(value) {
  const text = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(text);
  if (!match || (match[4] !== undefined && Number(match[4]) !== 1)) return null;
  const values = match.slice(1, 4).map(Number);
  if (values.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 255)) return null;
  return '#' + values.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('');
}

// AccentColor is a CSS system color, not a privileged API for reading OS preferences.
export function readSystemAccentColor(documentRef) {
  const probe = documentRef.createElement('span');
  probe.style.color = 'AccentColor';
  if (!probe.style.color) return null;
  probe.style.colorScheme = documentRef.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  probe.style.display = 'none';
  try {
    (documentRef.body || documentRef.documentElement).appendChild(probe);
    return parseSystemAccentColor(documentRef.defaultView.getComputedStyle(probe).color);
  } catch (_) {
    return null;
  } finally {
    probe.remove();
  }
}

// Resolve UI colors only for appearance changes, never in a map draw loop.
export function applyAppAccent(documentRef) {
  const root = documentRef.documentElement;
  const hex = readSystemAccentColor(documentRef)
    || FALLBACK_ACCENTS[root.dataset.theme === 'dark' ? 'dark' : 'light'];
  for (const [name, value] of Object.entries(accentTokens(hex)))
    root.style.setProperty('--design-color-' + name, value);
  return hex;
}
