import { createNativeStorage } from './native-storage.js';

const DEFAULT_PROBE_HOLD_MS = 500;

export function createNativePlatformAdapter({
  scope = globalThis,
  loadModule = url => import(url),
  createStorage = createNativeStorage,
} = {}) {
  const bridge = scope.__TAURI_INTERNALS__;
  if (typeof bridge?.invoke !== 'function') {
    throw new Error('Native shell bridge is unavailable; shell startup requires Tauri IPC.');
  }
  const invoke = (command, payload) => bridge.invoke(command, payload);
  const hold = Number(scope.__PANDOLAB_SHELL_PROBE_HOLD_MS__);
  const runtime = Object.freeze({
    verification: scope.PANDOLAB_SHELL_VERIFICATION === true,
    libraryAvailable: scope.PANDOLAB_NATIVE_LIBRARY_AVAILABLE === true,
    autoVerification: scope.__PANDOLAB_SHELL_AUTO__ === true,
    probeHoldMs: Number.isFinite(hold) && hold > 0 ? hold : DEFAULT_PROBE_HOLD_MS,
    physicalImmediate: scope.__PANDOLAB_SHELL_PROBE_PHYSICAL_IMMEDIATE__ === true,
    buildInfo: scope.PANDOLAB_NATIVE_BUILD_INFO ?? null,
  });
  const storage = createStorage(invoke);
  let repositoryPromise = null;

  function assertVerification(stagedVerification, modulePresent) {
    const staged = stagedVerification === true;
    const module = modulePresent === true;
    if (staged !== module || runtime.verification !== module) {
      throw new Error('Verification assets do not match the native application.');
    }
  }

  async function preparePlatform({ profile, meta, versionedAsset, install = false } = {}) {
    if (!profile?.platform || !meta?.appVersion || typeof versionedAsset !== 'function') {
      throw new TypeError('Native platform preparation requires profile, metadata and a versioned asset resolver.');
    }
    const getLibraryRepository = runtime.libraryAvailable ? () => {
      if (!repositoryPromise) {
        repositoryPromise = loadModule(versionedAsset('./modules/native-library-repository.js').href)
          .then(({ createNativeLibraryRepository }) => createNativeLibraryRepository({ invoke }))
          .catch(error => { repositoryPromise = null; throw error; });
      }
      return repositoryPromise;
    } : null;

    let geometryContext = null;
    const { parseNativeLibraryGeometryRequest, createLibraryGeometryContext } =
      await loadModule(versionedAsset('./modules/library-geometry-context.js').href);
    const request = parseNativeLibraryGeometryRequest(scope.location?.search || '', true);
    if (request) {
      if (profile.mode !== 'map-data') throw new Error('라이브러리 형상 편집에는 실제 지도 자료를 포함한 앱이 필요합니다.');
      if (!getLibraryRepository) throw new Error('이 플랫폼은 라이브러리 형상 편집을 지원하지 않습니다.');
      const [{ createRepositoryTerritorialLoader }, { createTerritorialLibraryService }] = await Promise.all([
        loadModule(versionedAsset('./modules/territorial-entity-loader.js').href),
        loadModule(versionedAsset('./modules/territorial-library-service.js').href),
      ]);
      const repository = await getLibraryRepository();
      const service = createTerritorialLibraryService({ loader: createRepositoryTerritorialLoader(repository) });
      geometryContext = createLibraryGeometryContext({ repository, service, ...request, appVersion: meta.appVersion });
      await geometryContext.prepare();
      if (scope.document) scope.document.title = geometryContext.title;
    }

    const { createPlatformPorts } = await loadModule(versionedAsset('./modules/platform-ports.js').href);
    const platform = createPlatformPorts({
      kind: 'native',
      ...profile.platform,
      files: { access: storage },
      library: { getRepository: getLibraryRepository, geometryContext },
    });
    if (install) {
      const { installRuntimePlatform } = await loadModule(versionedAsset('./modules/platform-runtime.js').href);
      installRuntimePlatform(platform, { productMode: 'editor' });
    }
    return platform;
  }

  return Object.freeze({
    invoke,
    runtime,
    storage,
    assertVerification,
    preparePlatform,
    writeDiagnosticReport: storage.writeDiagnosticReport,
  });
}
