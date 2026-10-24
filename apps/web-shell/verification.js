import { createNativeStorage } from './native-storage.js';
import { installDiagnostics } from './diagnostics.js';
import { installFullWorldProbe } from './full-world-probe.js';
import { installReferenceRuntimeProbe } from './reference-analysis-probe.js';
export { finishDiagnostics } from './probe-storage.js';
export function installWorld(profile) {
  if (globalThis.__PANDOLAB_SHELL_REFERENCE_ANALYSIS__) installReferenceRuntimeProbe();
  else installFullWorldProbe({
    readyDelayMs: Number(globalThis.__PANDOLAB_SHELL_PROBE_HOLD_MS__) || 500,
    expectedSourceCount: profile.world.countryCount,
    expectedModelCount: profile.world.modelEntityCount,
    expectedRootCount: profile.world.rootCount,
  });
}

export async function createFixtureProfile(profile) {
  if (profile.mode !== 'small-project' || profile.verification !== true) throw new Error('The small-project profile requires explicit verification.');
  const profileUrl = new URL('./stage-profile.json', import.meta.url);
  const manifestUrl = new URL(profile.builtinWorld.url, profileUrl);
  const countriesUrl = new URL(profile.countriesUrl, profileUrl);
  for (const url of [manifestUrl, countriesUrl]) {
    if (url.origin !== profileUrl.origin) throw new Error('Shell fixture assets must use the local application origin.');
  }
  const { createBuiltinWorldLoader } = await import(new URL('../assets/js/modules/builtin-world-loader.js', import.meta.url));
  return Object.freeze({
    mode: 'small-project',
    countriesUrl,
    platform: Object.freeze({
      builtinWorldLoader: createBuiltinWorldLoader({
        manifestUrl: manifestUrl.href,
        manifestSpec: profile.builtinWorld,
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
      builtinHydroAvailable: false,
      builtinPlacesAvailable: false,
      startupMesh: 'project',
      storageNamespace: 'pandoeditor-web-shell-prototype-v1',
    }),
  });
}

export async function startFixture({ profile, meta, assetBase, versionedAsset }) {
  window.PANDOLAB_APP_VERSION = meta.appVersion;
  window.PANDOLAB_ASSET_REVISION = meta.assetRevision;
  window.PANDOLAB_DATA_REVISION = meta.dataRevision;
  window.PANDOLAB_ASSET_BASE_URL = assetBase.href;
  window.PANDOLAB_LABEL_ANCHORS = {};
  window.__PANDOLAB_STARTUP_METRICS__ = { source: 'desktop-tiny-fixture', startupPhase: 'project-loading' };
  let modalStyles;
  window.PANDOLAB_ENSURE_MODAL_STYLES = () => modalStyles ||= new Promise((resolve, reject) => {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = versionedAsset('../css/ui-modal.bundle.css').href;
    style.dataset.pandolabUiModal = 'ui-modal-bundle';
    style.addEventListener('load', () => resolve(style), { once: true });
    style.addEventListener('error', () => { modalStyles = null; reject(new Error('Modal styles unavailable.')); }, { once: true });
    document.head.append(style);
  });
  const countries = await fetch(profile.countriesUrl);
  if (!countries.ok) throw new Error(`Shell geometry unavailable (${countries.status}).`);
  window.PANDOLAB_COUNTRIES = await countries.json();
  const { composeApplication } = await import(versionedAsset('./modules/app-composition.js').href);
  let diagnostics;
  const application = await composeApplication({ productMode: 'editor', revision: meta.assetRevision,
    platform: { ...profile.platform, fileAccess: createNativeStorage() },
    onComposed: async runtime => { diagnostics = await installDiagnostics(runtime); },
  });
  if (!await application.start()) throw new Error('The application could not finish startup.');
  const { initializeUiRuntime } = await import(versionedAsset('./modules/ui-runtime.js').href);
  initializeUiRuntime(document);
  document.body.classList.remove('is-loading');
  document.getElementById('bootstrapLoading').hidden = true;
  document.getElementById('app').removeAttribute('aria-busy');
  window.__PANDOLAB_STARTUP_METRICS__.startupPhase = 'canonical-ready';
  window.dispatchEvent(new CustomEvent('pandolab:interactive'));
  window.__PANDOLAB_SHELL_READY__ = true;
  if (window.__PANDOLAB_SHELL_AUTO__) await diagnostics.run();
}
