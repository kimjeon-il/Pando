import { createRuntimeProfile } from './runtime-profile.js';
import { createNativeStorage, writeDiagnosticReport } from './native-storage.js';
import { installNetworkGuard } from './network-guard.js';
// Replaced by the staging owner only for verification builds.
const verification = null;

async function start() {
  if (document.readyState === 'loading' && (!globalThis.PANDOLAB_BUILD_META || !window.d3)) {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }
  const meta = globalThis.PANDOLAB_BUILD_META;
  if (!meta?.assetRevision || !window.d3) throw new Error('The bundled application dependencies are unavailable.');
  const profileMeta = await fetch(new URL('./stage-profile.json', import.meta.url)).then(response => {
    if (!response.ok) throw new Error('The bundled shell profile is missing.');
    return response.json();
  });
  if (!['small-project', 'full-world'].includes(profileMeta.mode)) throw new Error('Unknown shell resource profile.');
  if (profileMeta.verification !== !!verification
      || (typeof globalThis.__TAURI_INTERNALS__?.invoke === 'function'
        && globalThis.PANDOLAB_SHELL_VERIFICATION !== !!verification)) {
    throw new Error('Verification assets do not match the native application.');
  }
  installNetworkGuard(globalThis, { allowBundledData: profileMeta.mode === 'full-world' });
  const assetBase = new URL('../assets/js/', import.meta.url);
  const versionedAsset = relative => {
    const url = new URL(relative, assetBase);
    url.searchParams.set('v', meta.assetRevision);
    return url;
  };
  const profile = await createRuntimeProfile();
  let libraryGeometryContext = null;
  if (typeof globalThis.__TAURI_INTERNALS__?.invoke === 'function') {
    const { parseNativeLibraryGeometryRequest, createLibraryGeometryContext } =
      await import(versionedAsset('./modules/library-geometry-context.js').href);
    const request = parseNativeLibraryGeometryRequest(location.search, true);
    if (request) {
      if (profile.mode !== 'full-world') throw new Error('라이브러리 형상 편집에는 전체 지도 앱이 필요합니다.');
      const [{ createNativeLibraryRepository }, { createRepositoryTerritorialLoader },
        { createTerritorialLibraryService }] = await Promise.all([
        import(versionedAsset('./modules/native-library-repository.js').href),
        import(versionedAsset('./modules/territorial-entity-loader.js').href),
        import(versionedAsset('./modules/territorial-library-service.js').href),
      ]);
      const repository = createNativeLibraryRepository({ invoke: globalThis.__TAURI_INTERNALS__.invoke });
      const service = createTerritorialLibraryService({ loader: createRepositoryTerritorialLoader(repository) });
      libraryGeometryContext = createLibraryGeometryContext({
        repository, service, ...request, appVersion: meta.appVersion,
      });
      await libraryGeometryContext.prepare();
      document.title = libraryGeometryContext.title;
    }
  }
  if (profile.mode === 'full-world') {
    // The full-world shell must take precisely the website's progressive WebGL
    // preview -> canonical country packet -> canonical mesh startup path.
    globalThis.__PANDOLAB_SHELL_PLATFORM__ = Object.freeze({
      ...profile.platform,
      fileAccess: createNativeStorage(),
      libraryGeometryContext,
    });
    window.addEventListener('pandolab:ready', () => {
      window.__PANDOLAB_SHELL_READY__ = true;
    }, { once: true });
    if (verification && !libraryGeometryContext) verification.installWorld(profileMeta);
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = versionedAsset('./bootstrap.js').href;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Canonical Web bootstrap unavailable in the shell.'));
      document.body.appendChild(script);
    });
    return;
  }
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
    onComposed: async runtime => { if (verification) diagnostics = await verification.installDiagnostics(runtime); },
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
  if (verification && window.__PANDOLAB_SHELL_AUTO__) await diagnostics.run();
}

start().catch(async error => {
  console.error('[PANDOEDITOR-SHELL-STARTUP]', error);
  const message = document.getElementById('bootstrapLoadingText');
  if (message) message.textContent = error.message;
  const overlay = document.getElementById('bootstrapLoading');
  if (overlay) overlay.hidden = false;
  const report = { schema: 'pandolab-web-shell-diagnostics', ok: false, stage: 'startup',
    error: { name: String(error.name || 'Error'), code: String(error.code || ''), message: String(error.message || error), stack: String(error.stack || '') },
  };
  try {
    if (verification && window.__PANDOLAB_SHELL_AUTO__ === true) await verification.finishDiagnostics(report);
    else await writeDiagnosticReport(report);
  }
  catch (reportError) { console.error('[PANDOEDITOR-SHELL-REPORT]', reportError); }
});
