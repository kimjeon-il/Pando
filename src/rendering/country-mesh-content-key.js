import { polygonGeometryDigest } from "./prepared-polygon-mesh.js";
import { resourceKey } from "./resource-update-policy.js";
import { geometryReferenceFor } from "../geometry/geometry-version-store.js";

// Only Core-admitted, recursively frozen geometry may reuse its content digest.
// The resource identity remains the digest, not the object's identity.
const immutableDigests = new WeakMap();
async function verifiedGeometryDigest(geometry) {
  if (!geometryReferenceFor(geometry)) return polygonGeometryDigest(geometry);
  let pending=immutableDigests.get(geometry);
  if (!pending) { pending=polygonGeometryDigest(geometry); immutableDigests.set(geometry,pending); }
  try { return await pending; }
  catch (error) { if (immutableDigests.get(geometry)===pending) immutableDigests.delete(geometry); throw error; }
}

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
    rows.push([String(feature.id),geometry==null?'empty':await verifiedGeometryDigest(geometry)]);
    if(!isCurrent())return null;
  }
  if(!isCurrent())return null;
  return resourceKey(rows);
}

/**
 * A baked world mesh may replace a live scene only when every packed slot has
 * the same ID, order and *exact* Core-admitted polygon geometry. A matching
 * country count (or an identity object constructed from caller IDs) alone is
 * never proof of compatibility. Historical parent/child scope merges change
 * the visible topology, so those scenes stay on their own mesh path.
 */
export function builtinMeshMatchesScene({slotIds,features,geometryEquals} = {}) {
  if (!Array.isArray(slotIds) || !Array.isArray(features) || !slotIds.length
    || slotIds.length !== features.length || typeof geometryEquals !== 'function') return false;
  const seen = new Set();
  for (let index = 0; index < slotIds.length; index++) {
    const feature = features[index], id = String(feature?.id ?? '');
    if (!id || seen.has(id) || String(slotIds[index]) !== id || !feature?.geometry
      || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)
      || !geometryEquals(id, feature.geometry)) return false;
    seen.add(id);
  }
  return true;
}
