import { resolveMapInteractionStyle } from "../map/map-interaction-style.js";
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

export function getInteractionStyle() {
  return interactionStyle;
}
