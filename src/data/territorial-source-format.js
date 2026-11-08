export const territorialSourceLayout='geometry-resources-v1';

/** The authoring descriptor contract shared by data tools and review readers. */
export function validateTerritorialSourceGeometry(version,entityId){
 const resource=version?.geometryResource;
 if(typeof entityId!=='string'||typeof version?.versionId!=='string'||!version.versionId
   ||Object.hasOwn(version,'geometry')||!resource||resource.role!=='source'
   ||!['Polygon','MultiPolygon','LineString','MultiLineString'].includes(resource.type)
   ||resource.logicalRef?.id!==entityId+':'+version.versionId||resource.logicalRef.version!==1
   ||!/^[a-f0-9]{64}$/.test(resource.sha256||'')||resource.file!=='geometries/sha256-'+resource.sha256+'.json'
   ||!Number.isSafeInteger(resource.bytes)||resource.bytes<1)throw Error('Territorial geometry resource: invalid geometry resource identity');
 return resource;
}
