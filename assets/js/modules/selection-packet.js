const cloneItems = items => (items || []).map(item => ({ ...item }));

export function createSelectionPacket({
  revision = 0,
  hoverRevision = 0,
  geometryRevision = 0,
  styleRevision = 0,
  countryBoundaryRevision = '',
  territorialBoundaryRevision = '',
  channels = {},
  style = null,
} = {}) {
  return Object.freeze({
    revision: Number(revision || 0),
    hoverRevision: Number(hoverRevision || 0),
    geometryRevision: String(geometryRevision ?? ''),
    styleRevision: String(styleRevision ?? ''),
    countryBoundaryRevision: String(countryBoundaryRevision || ''),
    territorialBoundaryRevision: String(territorialBoundaryRevision || ''),
    channels: Object.freeze(Object.fromEntries(['candidate', 'hover', 'primary', 'secondary'].map(channel =>
      [channel, Object.freeze(cloneItems(channels[channel]))]))),
    style,
  });
}
