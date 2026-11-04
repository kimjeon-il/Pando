const revisions = new WeakMap();
const identities = new WeakMap();
let nextIdentity = 0;
export function geometryIdentity(geometry) {
  if (!geometry || typeof geometry !== 'object') return 0;
  if (!identities.has(geometry)) identities.set(geometry, ++nextIdentity);
  return identities.get(geometry);
}
export const geometryRevisionKey = geometry => `${geometryIdentity(geometry)}:${geometryRevision(geometry)}`;
export const geometryRevision = geometry => geometry && revisions.get(geometry) || 0;
export function touchGeometry(geometry) {
  if (geometry) revisions.set(geometry, geometryRevision(geometry) + 1);
}
