import { polygonGeometryDigest } from './prepared-polygon-mesh.js';
import { resourceKey } from './resource-update-policy.js';

/**
 * Exact identity for one retained canonical country mesh, not another cache.
 * New objects with identical geometry match. Changed polygons, holes, country
 * IDs and ordering do not. Styles and selections are independent resources.
 * Caller-supplied current checks prevent stale asynchronous digest results.
 */
export async function countryMeshContentKey(features,{isCurrent=()=>true}={}){
  if(!Array.isArray(features)||typeof isCurrent!=='function')
    throw new TypeError('Canonical mesh requires country features and a current-request predicate.');
  const rows=[];
  for(const feature of features){
    if(!isCurrent())return null;
    if(!feature||feature.id==null)throw new TypeError('Canonical mesh country IDs are required.');
    const geometry=feature.geometry;
    if(geometry!=null&&!['Polygon','MultiPolygon'].includes(geometry.type))
      throw new TypeError('Canonical country mesh requires polygon geometry.');
    rows.push([String(feature.id),geometry==null?'empty':await polygonGeometryDigest(geometry)]);
    if(!isCurrent())return null;
  }
  if(!isCurrent())return null;
  return resourceKey(rows);
}
