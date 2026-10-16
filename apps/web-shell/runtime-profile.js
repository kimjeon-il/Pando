/** Explicit, local-only asset selection for the desktop prototype. */
export async function createRuntimeProfile() {
  const profileUrl = new URL('./stage-profile.json', import.meta.url);
  const response = await fetch(profileUrl);
  if (!response.ok) throw new Error(`Shell profile unavailable (${response.status}).`);
  const profile = await response.json();
  const manifestUrl = new URL(profile.historicalWorld.url, profileUrl);
  const countriesUrl = new URL(profile.countriesUrl, profileUrl);
  for (const url of [manifestUrl, countriesUrl]) {
    if (url.origin !== profileUrl.origin) throw new Error('Shell fixture assets must use the local application origin.');
  }
  const { createHistoricalWorldLoader } = await import(new URL('../assets/js/modules/historical-world-loader.js', import.meta.url));
  return Object.freeze({
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
