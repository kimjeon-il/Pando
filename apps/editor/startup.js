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
  if (profileMeta.mode !== 'map-data' && !verification) throw new Error('Ordinary startup requires the map-data profile.');
  if (profileMeta.verification !== !!verification
      || (typeof globalThis.__TAURI_INTERNALS__?.invoke === 'function'
        && globalThis.PANDOLAB_SHELL_VERIFICATION !== !!verification)) {
    throw new Error('Verification assets do not match the native application.');
  }
  installNetworkGuard(globalThis, { allowBundledData: profileMeta.mode === 'map-data' });
  const assetBase = new URL('../assets/js/', import.meta.url);
  const runtimeModuleUrl=new URL('../assets/js/modules/runtime-context.js',import.meta.url);
  runtimeModuleUrl.searchParams.set('v',meta.assetRevision);
  const {validateBuildMetadata,versionedAssetUrl}=await import(runtimeModuleUrl.href);
  validateBuildMetadata(meta);
  const versionedAsset=relative=>versionedAssetUrl(relative,assetBase,meta.assetRevision);
  const profile = profileMeta.mode === 'map-data'
    ? await createRuntimeProfile(profileMeta,meta) : await verification.createFixtureProfile(profileMeta);
  let repositoryPromise;
  const getLibraryRepository=globalThis.PANDOLAB_NATIVE_LIBRARY_AVAILABLE===true?()=>{
    if(!repositoryPromise)repositoryPromise=import(versionedAsset('./modules/native-library-repository.js').href)
      .then(({createNativeLibraryRepository})=>createNativeLibraryRepository({invoke:globalThis.__TAURI_INTERNALS__.invoke}))
      .catch(error=>{repositoryPromise=null;throw error;});
    return repositoryPromise;
  }:null;
  let libraryGeometryContext = null;
  if (typeof globalThis.__TAURI_INTERNALS__?.invoke === 'function') {
    const { parseNativeLibraryGeometryRequest, createLibraryGeometryContext } =
      await import(versionedAsset('./modules/library-geometry-context.js').href);
    const request = parseNativeLibraryGeometryRequest(location.search, true);
    if (request) {
      if (profile.mode !== 'map-data') throw new Error('라이브러리 형상 편집에는 실제 지도 자료를 포함한 앱이 필요합니다.');
      if(!getLibraryRepository)throw new Error('이 플랫폼은 라이브러리 형상 편집을 지원하지 않습니다.');
      const [{ createRepositoryTerritorialLoader },
        { createTerritorialLibraryService }] = await Promise.all([
        import(versionedAsset('./modules/territorial-entity-loader.js').href),
        import(versionedAsset('./modules/territorial-library-service.js').href),
      ]);
      const repository = await getLibraryRepository();
      const service = createTerritorialLibraryService({ loader: createRepositoryTerritorialLoader(repository) });
      libraryGeometryContext = createLibraryGeometryContext({
        repository, service, ...request, appVersion: meta.appVersion,
      });
      await libraryGeometryContext.prepare();
      document.title = libraryGeometryContext.title;
    }
  }
  if (profile.mode === 'map-data') {
    // The map-data shell must take precisely the website's progressive WebGL
    // preview -> canonical country packet -> canonical mesh startup path.
    globalThis.__PANDOLAB_SHELL_PLATFORM__ = Object.freeze({
      ...profile.platform,
      fileAccess: createNativeStorage(),
      getLibraryRepository,
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
  await verification.startFixture({ profile, meta, assetBase, versionedAsset });
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
