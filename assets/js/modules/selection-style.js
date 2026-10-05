import { resolveMapInteractionStyle } from './map-interaction-style.js';
let interactionStyle = resolveMapInteractionStyle();
export const SELECTION_STYLE = {
  color: interactionStyle.selection.color,
  primaryWidth: interactionStyle.selection.primary.innerWidth,
  primaryAlpha: interactionStyle.selection.primary.innerAlpha,
  secondaryWidth: interactionStyle.selection.secondary.innerWidth,
  secondaryAlpha: interactionStyle.selection.secondary.innerAlpha,
};

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
    tokens: {},
  }));
  return SELECTION_STYLE.color;
}

export function getInteractionStyle() {
  return interactionStyle;
}
