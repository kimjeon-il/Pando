import { PROJECT_SCHEMA_VERSION } from "../runtime/version-contract.js";

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const packageError = (code, message) => Object.assign(new TypeError(message), { code });
const ordered = value => Array.isArray(value) ? value.map(ordered)
  : isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;

/** Only the current project JSON is authoritative; auxiliary GeoPackage tables are verification/asset sidecars. */
export function validateImportedProjectPackage(metadata) {
  const project = metadata?.projectState;
  if (!isRecord(project)) throw packageError('PL-GPKG-PROJECT', 'GeoPackage에 프로젝트 정본 JSON이 없습니다.');
  if (project.format !== 'pandolab-project-state' || project.schemaVersion !== PROJECT_SCHEMA_VERSION)
    throw packageError('PL-GPKG-VERSION', `현재 프로젝트 스키마 ${PROJECT_SCHEMA_VERSION} 형식만 읽을 수 있습니다.`);
  if (typeof project.documentId !== 'string' || !project.documentId.trim()
    || !Array.isArray(project.territorialEntities))
    throw packageError('PL-GPKG-PROJECT', '프로젝트 ID 또는 영역 목록이 올바르지 않습니다.');
  // The writer duplicates sourceInfo in an informational table. It must never replace JSON provenance.
  if (metadata.sourceInfo != null) {
    const original = project.sourceInfo ?? {};
    if (!isRecord(original) || !isRecord(metadata.sourceInfo)
      || JSON.stringify(ordered(original)) !== JSON.stringify(ordered(metadata.sourceInfo)))
      throw packageError('PL-GPKG-SOURCE-MISMATCH', 'GeoPackage 원본 출처 정보가 프로젝트 정본과 일치하지 않습니다.');
  }
  return project;
}

const validBase64 = text => typeof text === 'string' && text.length > 0 && text.length % 4 === 0
  && /^[A-Za-z0-9+/]+={0,2}$/.test(text);

/** Restore a separately stored country flag only if the canonical JSON has no flag of its own. */
export function applyImportedPackageAssets(metadata, entities) {
  if (!Array.isArray(entities)) throw packageError('PL-GPKG-PROJECT', '프로젝트 영역 목록이 올바르지 않습니다.');
  const assets = metadata?.countryAssets ?? [];
  if (!Array.isArray(assets)) throw packageError('PL-GPKG-ASSET', '프로젝트 국기 자료 목록이 올바르지 않습니다.');
  if (!assets.length) return entities;
  const byId = new Map();
  for (const asset of assets) {
    const id = asset?.countryId;
    const mime = asset?.mimeType || 'application/octet-stream';
    if (typeof id !== 'string' || !id.trim() || typeof mime !== 'string'
      || !/^(?:image\/[a-z0-9.+-]+|application\/octet-stream)$/i.test(mime) || !validBase64(asset?.base64))
      throw packageError('PL-GPKG-ASSET', '프로젝트 국기 자료가 올바르지 않습니다.');
    if (byId.has(id)) throw packageError('PL-GPKG-ASSET-DUPLICATE', `중복된 국기 자료 ID: ${id}`);
    byId.set(id, `data:${mime};base64,${asset.base64}`);
  }
  const consumed = new Set();
  const restored = entities.map(entity => {
    const id = entity?.id;
    if (!byId.has(id) || entity?.properties?.entityKind !== 'general') return entity;
    consumed.add(id);
    const url = byId.get(id), stored = entity.properties.metadata || {};
    if (Object.hasOwn(stored, 'flagDataUrl')) {
      if (stored.flagDataUrl !== url)
        throw packageError('PL-GPKG-ASSET-CONFLICT', `프로젝트 정본 국기와 별도 국기 자료가 다릅니다: ${id}`);
      return entity;
    }
    return { ...entity, properties: { ...entity.properties,
      metadata: { ...stored, flagDataUrl: url } } };
  });
  if (consumed.size !== byId.size)
    throw packageError('PL-GPKG-ASSET-ORPHAN', '프로젝트에 존재하지 않는 일반 객체의 국기 자료가 있습니다.');
  return restored;
}
