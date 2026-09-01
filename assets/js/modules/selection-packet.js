const cloneItems = items => (items || []).map(item => ({ ...item }));

export function createSelectionPacket({
  revision = 0,
  geometryRevision = 0,
  styleRevision = 0,
  countryBoundaryRevision = '',
  territorialBoundaryRevision = '',
  country = {},
  generic = {},
  style = null,
} = {}) {
  return Object.freeze({
    revision: Number(revision || 0),
    geometryRevision: String(geometryRevision ?? ''),
    styleRevision: String(styleRevision ?? ''),
    countryBoundaryRevision: String(countryBoundaryRevision || ''),
    territorialBoundaryRevision: String(territorialBoundaryRevision || ''),
    country: Object.freeze({
      hoverId: String(country.hoverId || ''),
      primaryId: String(country.primaryId || ''),
      secondaryIds: Object.freeze([...(country.secondaryIds || [])].map(String).filter(Boolean)),
    }),
    generic: Object.freeze({
      hover: Object.freeze(cloneItems(generic.hover)),
      primary: Object.freeze(cloneItems(generic.primary)),
      secondary: Object.freeze(cloneItems(generic.secondary)),
    }),
    style,
  });
}
