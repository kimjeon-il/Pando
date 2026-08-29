const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create a sprite-backed icon without duplicating inline SVG markup. */
export function createSvgIcon(documentRef, symbolId, className = 'ui-icon') {
  const icon = documentRef.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('class', className);
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const use = documentRef.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${symbolId}`);
  icon.appendChild(use);
  return icon;
}
