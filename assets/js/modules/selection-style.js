import { resolveMapInteractionStyle } from './map-interaction-style.js';
export const SELECTION_STYLE = {
  color: '#cda95d',
  primaryWidth: 2.5,
  primaryAlpha: 1,
  secondaryWidth: 1.5,
  secondaryAlpha: 0.72,
};

let interactionStyle = resolveMapInteractionStyle();

export function setInteractionStyle(nextStyle) {
  if (!nextStyle?.hover || !nextStyle?.selection) return interactionStyle;
  interactionStyle = nextStyle;
  SELECTION_STYLE.color = nextStyle.selection.color;
  SELECTION_STYLE.primaryWidth = nextStyle.selection.primary.innerWidth;
  SELECTION_STYLE.primaryAlpha = nextStyle.selection.primary.innerAlpha;
  SELECTION_STYLE.secondaryWidth = nextStyle.selection.secondary.innerWidth;
  SELECTION_STYLE.secondaryAlpha = nextStyle.selection.secondary.innerAlpha;
  return interactionStyle;
}

export function setSelectionColor(color) {
  const value = String(color || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) setInteractionStyle(resolveMapInteractionStyle({
    theme: interactionStyle.theme, selectionColor: value,
    outlineVisible: interactionStyle.selection.outlineVisible, fillStrength: interactionStyle.selection.fillStrength,
    tokens: { textStrong: interactionStyle.selection.casingColor },
  }));
  return SELECTION_STYLE.color;
}

export function getInteractionStyle() {
  return interactionStyle;
}
