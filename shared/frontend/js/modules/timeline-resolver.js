import { sharedCalculationCore } from './temporal.js';

for (const name of ['timelineInitialMonth', 'timelineResolveWorld']) {
  if (typeof sharedCalculationCore[name] !== 'function')
    throw Object.assign(new Error('Canonical C++ timeline capability is unavailable: ' + name),
      { code: 'PL-CORE-WASM-CAPABILITY' });
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function initialTimelineMonth(records, currentMonth) {
  return sharedCalculationCore.timelineInitialMonth(records, currentMonth);
}

/** Map the C++ resolved typed values onto the current Web presentation DTO. */
export function projectTimelineIdentity(identity, values) {
  if (!Object.keys(values).length) return identity;
  const properties = { ...identity.properties, style: { ...identity.properties.style }, metadata: { ...identity.properties.metadata } };
  if (values.name) {
    properties.name = values.name.name;
    properties.metadata.nameSource = { baseName: properties.metadata.nameSource?.baseName || '', nameExplicit: values.name.nameExplicit };
  }
  if (values.color) {
    if (values.color.explicitColor) properties.style.color = '#' + values.color.color.toString(16).padStart(6, '0');
    else delete properties.style.color;
  }
  if (values.flag) {
    if (values.flag.policy === 'default') delete properties.metadata.flagDataUrl;
    else properties.metadata.flagDataUrl = values.flag.policy === 'none' ? null : values.flag.embeddedDataUrl;
  }
  return freeze({ ...identity, properties });
}

/** Only attach Web identities and immutable geometry allocations to C++ world results. */
export function resolveWorld(identities, records, geometries, month) {
  const context = {
    entities: identities.map(identity => ({ id: identity.id, entityKind: identity.properties?.entityKind })),
    geometryExists: ref => geometries.get(ref) != null,
  };
  const resolved = sharedCalculationCore.timelineResolveWorld(records, context, month);
  const identityById = new Map(identities.map(identity => [identity.id, identity]));
  const rows = resolved.entities.map(result => {
    const row = {
      id: result.id,
      identity: projectTimelineIdentity(freeze(structuredClone(identityById.get(result.id))), result.properties),
      geometryRef: Object.freeze(result.geometryRef),
      geometry: geometries.get(result.geometryRef),
      parentId: result.parentId,
      coverageMode: result.coverageMode,
      validFrom: result.validFrom,
      validTo: result.validTo,
      ancestors: Object.freeze([...result.ancestors]),
      rootId: result.rootId,
    };
    return Object.freeze(row);
  });
  const byId = new Map(rows.map(row => [row.id, row]));
  return Object.freeze({
    month: resolved.month,
    entities: Object.freeze(rows),
    byId: Object.freeze({ get: id => byId.get(id) }),
  });
}

export function resolvedTimelineViews(identities, records, geometries, month) {
  return Object.freeze(resolveWorld(identities, records, geometries, month).entities.map(row => {
    const properties = Object.freeze({ ...row.identity.properties, parentId: row.parentId,
      coverageMode: row.coverageMode, validFrom: row.validFrom, validTo: row.validTo });
    return Object.freeze({ ...row.identity, properties, geometry: row.geometry });
  }));
}
