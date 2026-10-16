/** Explicit, local-only asset selection for the desktop prototype. */
export async function createRuntimeProfile() {
  const profileUrl = new URL('./stage-profile.json', import.meta.url);
  const response = await fetch(profileUrl);
  if (!response.ok) throw new Error(`Shell profile unavailable (${response.status}).`);
  const profile = await response.json();
  if (profile.mode === 'full-world') {
    const meta = globalThis.PANDOLAB_BUILD_META;
    if (!meta?.historicalWorld || meta.resourceProfile !== 'full-world'
        || profile.dataRevision !== meta.dataRevision
        || profile.assetRevision !== meta.assetRevision) {
      throw new Error('Bundled full-world assets do not match the running application.');
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
      mode: 'full-world',
      platform: Object.freeze({
        physicalResourcesEnabled: true,
        builtinPlacesEnabled: true,
        startupMesh: 'builtin',
        storageNamespace: 'pandoeditor-web-shell-world-v1',
      }),
    });
  }
  if (profile.mode !== 'small-project') throw new Error('Unsupported shell resource profile.');
  const manifestUrl = new URL(profile.historicalWorld.url, profileUrl);
  const countriesUrl = new URL(profile.countriesUrl, profileUrl);
  for (const url of [manifestUrl, countriesUrl]) {
    if (url.origin !== profileUrl.origin) throw new Error('Shell fixture assets must use the local application origin.');
  }
  const { createHistoricalWorldLoader } = await import(new URL('../assets/js/modules/historical-world-loader.js', import.meta.url));
  return Object.freeze({
    mode: 'small-project',
    countriesUrl,
    platform: Object.freeze({
      historicalWorldLoader: createHistoricalWorldLoader({
        manifestUrl: manifestUrl.href,
        manifestSpec: profile.historicalWorld,
        dataRevision: 'pandoeditor-shell-fixture-v1',
        fetchFn: (target, options) => {
          const url = new URL(target, profileUrl);
          if (url.origin !== profileUrl.origin || !url.pathname.startsWith(new URL('./', profileUrl).pathname)) {
            throw new Error('Historical fixture source escaped the local shell assets.');
          }
          return fetch(url, options);
        },
        // The shell must not share the website's world cache or its cleanup.
        cacheStorage: null,
      }),
      physicalResourcesEnabled: false,
      builtinPlacesEnabled: false,
      startupMesh: 'project',
      storageNamespace: 'pandoeditor-web-shell-prototype-v1',
    }),
  });
}
