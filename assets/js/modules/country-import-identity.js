const text = value => String(value ?? '').trim();
const OFFICIAL_ID_FIELDS = new Set(['adm0_a3', 'iso_a3', 'gid_0', '__feature_id__']);
const SAFE_SOURCE_ID = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,127}$/u;

function normalizedIdentity(raw = {}) {
  return {
    sourceNamespace: text(raw.sourceNamespace).toLowerCase(),
    sourceIdField: text(raw.sourceIdField),
    sourceId: text(raw.sourceId),
    pandolabId: text(raw.pandolabId),
  };
}

export function countryImportIdentity(feature) {
  const properties = feature?.properties || {};
  const identity = normalizedIdentity(feature?.importIdentity || properties.importIdentity || {
    sourceId: properties.pandolab_id || feature?.id,
    sourceIdField: properties.pandolab_id ? 'pandolab_id' : '',
    sourceNamespace: properties.pandolab_id ? 'pandolab' : '',
    pandolabId: properties.pandolab_id,
  });
  if (!identity.sourceId) identity.sourceId = text(properties.pandolab_id || feature?.id);
  if (!identity.sourceIdField && properties.pandolab_id) identity.sourceIdField = 'pandolab_id';
  if (!identity.sourceNamespace && properties.pandolab_id) identity.sourceNamespace = 'pandolab';
  if (!identity.pandolabId && properties.pandolab_id) identity.pandolabId = text(properties.pandolab_id);
  return identity;
}

export function countryImportIdentityKey(identityOrFeature) {
  const identity = identityOrFeature?.type === 'Feature'
    ? countryImportIdentity(identityOrFeature)
    : normalizedIdentity(identityOrFeature);
  return [identity.sourceNamespace, identity.sourceIdField.toLowerCase(), identity.sourceId].join(':');
}

function incomingName(feature, index) {
  const properties = feature?.properties || {};
  return text(properties.name || properties.pandolab_name || properties.NAME_KO || properties.NAME_0 || properties.NAME)
    || `국가 ${index + 1}`;
}

export function resolveCountryIdentities(incomingFeatures = [], existingCountries = [], {
  manualMappings = {},
  allowImplicitNew = false,
} = {}) {
  const existingById = new Map((existingCountries || [])
    .map(feature => [text(feature?.id), feature])
    .filter(([id]) => id));
  return (incomingFeatures || []).map((feature, index) => {
    const identity = countryImportIdentity(feature);
    const sourceKey = countryImportIdentityKey(identity);
    const manual = text(manualMappings?.[sourceKey]);
    if (manual === 'new') {
      return { status: 'new', editorId: null, existingCountry: null, candidates: [], sourceIdentity: identity, sourceKey, feature, name: incomingName(feature, index), resolutionReason: 'manual-new' };
    }
    if (manual.startsWith('existing:')) {
      const editorId = manual.slice('existing:'.length);
      const existingCountry = existingById.get(editorId) || null;
      if (existingCountry) return { status: 'existing', editorId, existingCountry, candidates: [], sourceIdentity: identity, sourceKey, feature, name: incomingName(feature, index), resolutionReason: 'manual-existing' };
    }

    const trustedId = text(identity.pandolabId || (OFFICIAL_ID_FIELDS.has(identity.sourceIdField.toLowerCase()) ? identity.sourceId : ''));
    const existingCountry = existingById.get(trustedId) || null;
    if (existingCountry) {
      return {
        status: 'existing', editorId: trustedId, existingCountry,
        candidates: [{ editorId: trustedId, reason: identity.pandolabId ? 'pandolab-id' : 'official-id', confidence: identity.pandolabId ? 1 : 0.96 }],
        sourceIdentity: identity, sourceKey, feature, name: incomingName(feature, index),
        resolutionReason: identity.pandolabId ? 'pandolab-id' : 'official-id',
      };
    }
    return { status: allowImplicitNew ? 'new' : 'unresolved', editorId: null, existingCountry: null, candidates: [], sourceIdentity: identity, sourceKey, feature, name: incomingName(feature, index), resolutionReason: allowImplicitNew ? 'replace-project' : 'no-match' };
  });
}

function trustedNewId(identity) {
  const official = OFFICIAL_ID_FIELDS.has(text(identity?.sourceIdField).toLowerCase());
  const candidate = text(identity?.pandolabId || (official ? identity?.sourceId : ''));
  return SAFE_SOURCE_ID.test(candidate) ? candidate : '';
}

export function materializeResolvedCountries(resolutions, { createId = () => globalThis.crypto.randomUUID() } = {}) {
  const unresolved = (resolutions || []).filter(row => !['existing', 'new'].includes(row.status));
  if (unresolved.length) {
    const error = new Error('가져온 국가의 기존 국가 ID를 모두 확인해야 합니다.');
    error.code = 'PL-GIS-IDENTITY-001';
    error.unresolved = unresolved.map(row => row.sourceKey);
    throw error;
  }
  const usedIds = new Set();
  return (resolutions || []).map(row => {
    const preferred = row.status === 'existing' ? text(row.editorId) : trustedNewId(row.sourceIdentity);
    let id = preferred;
    if (!id || usedIds.has(id)) id = text(createId());
    if (!id || usedIds.has(id)) throw new Error('새 국가의 프로젝트 ID를 만들지 못했습니다.');
    usedIds.add(id);
    const sourceProperties = row.feature?.properties || {};
    const existingProperties = row.existingCountry?.properties || {};
    const properties = {
      name: row.status === 'existing' ? (text(existingProperties.name) || row.name || id) : (row.name || id),
    };
    const validFrom = text(sourceProperties.validFrom);
    const validTo = text(sourceProperties.validTo);
    if (validFrom) properties.validFrom = validFrom;
    else if (text(existingProperties.validFrom)) properties.validFrom = text(existingProperties.validFrom);
    if (validTo) properties.validTo = validTo;
    else if (text(existingProperties.validTo)) properties.validTo = text(existingProperties.validTo);
    return { type: 'Feature', id, properties, geometry: structuredClone(row.feature?.geometry) };
  });
}

export function identityResolutionSummary(resolutions = []) {
  return resolutions.reduce((summary, row) => {
    summary[row.status] = (summary[row.status] || 0) + 1;
    return summary;
  }, { existing: 0, new: 0, ambiguous: 0, unresolved: 0 });
}
