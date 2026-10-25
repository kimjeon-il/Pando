const NS = 'http://www.w3.org/2000/svg';

/** Reuses projected paths. No geometry clipping or coordinate copies occur here. */
export function applySvgInteractionMasks(root, nodes, entries, { prefix = 'interaction', waterPaths = [] } = {}) {
  if (!root?.ownerDocument || !nodes.length) return;
  const document = root.ownerDocument;
  const make = (name, attributes = {}) => {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  const defs = make('defs');
  const ranked = [...new Map(entries.filter(entry => entry.path && entry.fillAlpha > 0).map(entry => [entry.key, entry])).values()];
  for (const [index, node] of nodes.entries()) {
    const key = node.getAttribute('data-object-key');
    const rank = ranked.findIndex(entry => entry.key === key);
    if (rank < 0) continue;
    const mask = make('mask', { id: `${prefix}-${index}`, maskUnits: 'userSpaceOnUse',
      x: '-100000', y: '-100000', width: '200000', height: '200000', 'mask-type': 'luminance' });
    mask.appendChild(make('rect', { x: '-100000', y: '-100000', width: '200000', height: '200000', fill: 'white' }));
    for (const entry of [...ranked.slice(0, rank), ...waterPaths]) {
      const path = make('path', { d: entry.path, class: 'map-selection-mask-shape',
        'data-object-key': entry.key || '', 'fill-rule': 'evenodd',
        fill: entry.width ? 'none' : 'black', stroke: entry.width ? 'black' : 'none', 'stroke-width': entry.width || 0 });
      path.__data__ = entry.feature;
      mask.appendChild(path);
    }
    defs.appendChild(mask);
    node.setAttribute('mask', `url(#${prefix}-${index})`);
  }
  root.insertBefore(defs, root.firstChild);
}
