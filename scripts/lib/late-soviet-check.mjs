// Fixed geometry-version partition; not a simultaneous date snapshot.
// The paired catalog retains these original fifteen republic outlines, but
// Lithuania's admitted geometry period ends before the other fourteen begin.
// Earlier reviewed versions and historical predecessors have separate contracts.
const parentVersionId = 'state:soviet-union:1922-1991-baikonur-r1-after-reviewed-day';
const republicIds = Object.freeze([
  'state:soviet-union-armenian-ssr',
  'state:soviet-union-azerbaijan-ssr',
  'state:soviet-union-byelorussian-ssr',
  'state:soviet-union-estonian-ssr',
  'state:soviet-union-georgian-ssr',
  'state:soviet-union-kazakh-ssr',
  'state:soviet-union-kirghiz-ssr',
  'state:soviet-union-lithuanian-ssr',
  'state:soviet-union-latvian-ssr',
  'state:soviet-union-moldavian-ssr',
  'state:soviet-union-russian-sfsr',
  'state:soviet-union-tajik-ssr',
  'state:soviet-union-turkmen-ssr',
  'state:soviet-union-ukrainian-ssr',
  'state:soviet-union-uzbek-ssr',
]);

export function selectLateSovietCheckPartition(entities) {
  const byId = new Map(entities.map(entity => [entity.entityId, entity]));
  const select = (entityId, versionId) => {
    const entity = byId.get(entityId);
    if (!entity) throw new Error('Missing fixed Soviet partition entity: ' + entityId);
    const version = entity.geometryVersions.find(candidate => candidate.versionId === versionId);
    if (!version) throw new Error('Missing fixed Soviet partition geometry version: ' + versionId);
    return { entity, version };
  };
  const parent = select('state:soviet-union', parentVersionId);
  return {
    parent: parent.entity,
    parentVersion: parent.version,
    children: republicIds.map(entityId => select(entityId, entityId + ':1991-r1')),
  };
}
