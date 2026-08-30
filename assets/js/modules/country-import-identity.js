const text = value => String(value ?? '').trim();

const OFFICIAL_ID_FIELDS = new Set([
  'adm0_a3', 'iso_a3', 'iso3', 'gid_0', 'sov_a3', 'gu_a3', 'su_a3',
]);

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
  const metadata = properties.metadata && typeof properties.metadata === 'object' ? properties.metadata : {};
  const identity = normalizedIdentity(metadata.importIdentity || {
    sourceNamespace: metadata.sourceNamespace,
    sourceIdField: metadata.sourceIdField,
    sourceId: metadata.sourceId,
    pandolabId: properties.pandolab_id,
  });
  if (!identity.sourceId) identity.sourceId = text(properties.pandolab_id || feature?.id);
  if (!identity.sourceIdField) identity.sourceIdField = properties.pandolab_id ? 'pandolab_id' : '';
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

function countryId(feature) {
  return text(feature?.properties?.editor_id || feature?.id);
}

function aliases(feature) {
  const properties = feature?.properties || {};
  const metadata = properties.metadata && typeof properties.metadata === 'object' ? properties.metadata : {};
  const values = Array.isArray(metadata.importIdentities) ? metadata.importIdentities : [];
  const legacy = metadata.sourceId ? [{
    sourceNamespace: metadata.sourceNamespace || '',
    sourceIdField: metadata.sourceIdField || '',
    sourceId: metadata.sourceId,
  }] : [];
  return [...values, ...legacy].map(normalizedIdentity).filter(identity => identity.sourceId);
}

function candidateMap(existingCountries) {
  const byEditorId = new Map();
  const bySourceKey = new Map();
  const byOfficialId = new Map();
  const byLegacyId = new Map();
  const add = (map, key, feature) => {
    const normalized = text(key).toLowerCase();
    if (!normalized) return;
    if (!map.has(normalized)) map.set(normalized, []);
    map.get(normalized).push(feature);
  };
  for (const feature of existingCountries || []) {
    const id = countryId(feature);
    if (id) byEditorId.set(id, feature);
    for (const alias of aliases(feature)) add(bySourceKey, countryImportIdentityKey(alias), feature);
    const properties = feature?.properties || {};
    for (const field of ['iso_a3', 'ISO_A3', 'ADM0_A3', 'SOV_A3', 'GID_0']) add(byOfficialId, properties[field], feature);
    add(byLegacyId, id, feature);
    add(byLegacyId, properties?.metadata?.sourceId, feature);
  }
  return { byEditorId, bySourceKey, byOfficialId, byLegacyId };
}

function uniqueCandidates(rows, reason, confidence) {
  const seen = new Map();
  for (const feature of rows || []) {
    const editorId = countryId(feature);
    if (editorId && !seen.has(editorId)) seen.set(editorId, {
      editorId,
      feature,
      reason,
      confidence,
    });
  }
  return [...seen.values()];
}

function incomingName(feature, index) {
  const properties = feature?.properties || {};
  return text(properties.editor_name || properties.editor_original_name || properties.pandolab_name || properties.name || properties.NAME)
    || `국가 ${index + 1}`;
}

export function resolveCountryIdentities(incomingFeatures = [], existingCountries = [], {
  manualMappings = {},
  allowImplicitNew = false,
} = {}) {
  const indexes = candidateMap(existingCountries);
  return (incomingFeatures || []).map((feature, index) => {
    const identity = countryImportIdentity(feature);
    const sourceKey = countryImportIdentityKey(identity);
    const manual = text(manualMappings?.[sourceKey]);
    if (manual === 'new') {
      return { status: 'new', editorId: null, existingCountry: null, candidates: [], sourceIdentity: identity, sourceKey, feature, name: incomingName(feature, index), resolutionReason: 'manual-new' };
    }
    if (manual.startsWith('existing:')) {
      const editorId = manual.slice('existing:'.length);
      const existingCountry = indexes.byEditorId.get(editorId) || null;
      if (existingCountry) return { status: 'existing', editorId, existingCountry, candidates: [], sourceIdentity: identity, sourceKey, feature, name: incomingName(feature, index), resolutionReason: 'manual-existing' };
    }

    let candidates = [];
    if (identity.pandolabId && indexes.byEditorId.has(identity.pandolabId)) {
      candidates = uniqueCandidates([indexes.byEditorId.get(identity.pandolabId)], 'pandolab-id', 1);
    }
    if (!candidates.length && identity.sourceNamespace && identity.sourceIdField && identity.sourceId) {
      candidates = uniqueCandidates(indexes.bySourceKey.get(sourceKey.toLowerCase()), 'source-key', 0.99);
    }
    if (!candidates.length && OFFICIAL_ID_FIELDS.has(identity.sourceIdField.toLowerCase())) {
      candidates = uniqueCandidates(indexes.byOfficialId.get(identity.sourceId.toLowerCase()), 'official-id', 0.96);
    }
    if (!candidates.length && identity.sourceId) {
      candidates = uniqueCandidates(indexes.byLegacyId.get(identity.sourceId.toLowerCase()), 'legacy-id', 0.9);
    }
    if (candidates.length === 1) {
      const match = candidates[0];
      return { status: 'existing', editorId: match.editorId, existingCountry: match.feature, candidates, sourceIdentity: identity, sourceKey, feature, name: incomingName(feature, index), resolutionReason: match.reason };
    }
    if (candidates.length > 1) {
      return { status: 'ambiguous', editorId: null, existingCountry: null, candidates: candidates.map(({ feature: _feature, ...candidate }) => candidate), sourceIdentity: identity, sourceKey, feature, name: incomingName(feature, index), resolutionReason: 'multiple-candidates' };
    }
    return { status: allowImplicitNew ? 'new' : 'unresolved', editorId: null, existingCountry: null, candidates: [], sourceIdentity: identity, sourceKey, feature, name: incomingName(feature, index), resolutionReason: allowImplicitNew ? 'replace-project' : 'no-match' };
  });
}

function mergedAliases(existing, identity) {
  const current = aliases(existing);
  const next = normalizedIdentity(identity);
  const wantedKey = countryImportIdentityKey(next).toLowerCase();
  if (next.sourceId && !current.some(alias => countryImportIdentityKey(alias).toLowerCase() === wantedKey)) current.push(next);
  return current.map(alias => ({
    sourceNamespace: alias.sourceNamespace,
    sourceIdField: alias.sourceIdField,
    sourceId: alias.sourceId,
  }));
}

export function materializeResolvedCountries(resolutions, {
  createId = () => globalThis.crypto.randomUUID(),
} = {}) {
  const unresolved = (resolutions || []).filter(row => !['existing', 'new'].includes(row.status));
  if (unresolved.length) {
    const error = new Error('가져온 국가의 기존 국가 ID를 모두 확인해야 합니다.');
    error.code = 'PL-GIS-IDENTITY-001';
    error.unresolved = unresolved.map(row => row.sourceKey);
    throw error;
  }
  return (resolutions || []).map(row => {
    const incoming = structuredClone(row.feature);
    const existing = row.existingCountry;
    const trustedPandolabId = row.status === 'new'
      && row.sourceIdentity?.sourceNamespace === 'pandolab'
      ? text(row.sourceIdentity?.pandolabId || row.sourceIdentity?.sourceId)
      : '';
    const editorId = row.status === 'existing' ? row.editorId : (trustedPandolabId || text(createId()));
    if (!editorId) throw new Error('새 국가의 프로젝트 ID를 만들지 못했습니다.');
    const incomingProperties = incoming.properties || {};
    const existingProperties = existing?.properties || {};
    const metadata = {
      ...(existingProperties.metadata && typeof existingProperties.metadata === 'object' ? existingProperties.metadata : {}),
      ...(incomingProperties.metadata && typeof incomingProperties.metadata === 'object' ? incomingProperties.metadata : {}),
      importIdentities: mergedAliases(existing, row.sourceIdentity),
    };
    delete metadata.importIdentity;
    incoming.id = editorId;
    incoming.properties = {
      ...existingProperties,
      ...incomingProperties,
      editor_id: editorId,
      editor_custom: row.status === 'new' ? true : existingProperties.editor_custom === true,
      metadata,
    };
    return incoming;
  });
}

export function identityResolutionSummary(resolutions = []) {
  return resolutions.reduce((summary, row) => {
    summary[row.status] = (summary[row.status] || 0) + 1;
    return summary;
  }, { existing: 0, new: 0, ambiguous: 0, unresolved: 0 });
}
