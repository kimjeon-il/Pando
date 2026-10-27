/** Ordinary app runtime: the real pinned world only. */
export async function createRuntimeProfile(profile,meta) {
  if (profile.mode !== 'map-data') throw new Error('Ordinary runtime requires the map-data profile.');
  const profileUrl = new URL('./stage-profile.json', import.meta.url);
  if (!meta?.builtinWorld || meta.resourceProfile !== 'map-data'
      || profile.dataRevision !== meta.dataRevision
      || profile.assetRevision !== meta.assetRevision) {
    throw new Error('Bundled map-data assets do not match the running application.');
  }
  const root = new URL('../', import.meta.url);
  const worldManifest = new URL('assets/data/world/current.json', root);
  if (worldManifest.origin !== profileUrl.origin) throw new Error('World bundle escaped the local application origin.');
  const response = await fetch(worldManifest);
  if (!response.ok) throw new Error('Bundled world manifest unavailable.');
  const world = await response.json();
  if (world.schema !== 'pandolab-world-bundle' || world.source?.countryCount !== 258) {
    throw new Error('Bundled world manifest has no canonical 258-country dataset.');
  }
  return Object.freeze({
    mode: 'map-data',
    platform: Object.freeze({
      builtinHydroAvailable: true,
      builtinPlacesAvailable: true,
      startupMesh: 'builtin',
      storageNamespace: 'pandoeditor-web-shell-world-v1',
    }),
  });
}
