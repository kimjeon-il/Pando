export const SELECTION_STYLE = {
  color: '#cda95d',
  primaryWidth: 2.5,
  primaryAlpha: 1,
  secondaryWidth: 1.5,
  secondaryAlpha: 0.72,
};

let interactionStyle = Object.freeze({
  hover: Object.freeze({ color: '#d7ba7d', width: 1.5, alpha: 1, fillAlpha: 0.05775 }),
  selection: Object.freeze({
    color: '#cda95d',
    casingColor: '#f2f4f6',
    primary: Object.freeze({ innerWidth: 2.5, innerAlpha: 1, outerWidth: 4, casingAlpha: 0.72, fillAlpha: 0.13 }),
    secondary: Object.freeze({ innerWidth: 1.5, innerAlpha: 0.72, outerWidth: 2.8, casingAlpha: 0.48, fillAlpha: 0.08 }),
  }),
});

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
  if (/^#[0-9a-f]{6}$/i.test(value)) SELECTION_STYLE.color = value.toLowerCase();
  return SELECTION_STYLE.color;
}

export function getInteractionStyle() {
  return interactionStyle;
}
