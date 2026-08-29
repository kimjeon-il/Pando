async function fetchManifest({ fetchWithRetry, url, operation, onRetry }) {
  const response = await fetchWithRetry(url, {}, {
    maxAttempts: 3,
    baseDelay: 400,
    maxDelay: 2400,
    timeoutMs: 15000,
    onRetry: ({ attempt }) => onRetry(operation, attempt),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function createTerrainService({
  fetchWithRetry,
  manifestUrl,
  getLoadState,
  onLoading,
  onRetry,
  acceptManifest,
  onFailure,
}) {
  async function load(force = false) {
    if (!force && ['loading', 'ready'].includes(getLoadState())) return false;
    onLoading();
    try {
      const manifest = await fetchManifest({ fetchWithRetry, url: manifestUrl(), operation: 'terrain-manifest', onRetry });
      if (!manifest.levels?.length) throw new Error('지형 타일 manifest가 올바르지 않습니다.');
      await acceptManifest(manifest);
      return true;
    } catch (error) {
      onFailure(error);
      return false;
    }
  }

  return Object.freeze({ load });
}

export function createHydroService({
  fetchWithRetry,
  dataVersion,
  manifestUrl,
  getLoadState,
  onLoading,
  onRetry,
  acceptManifest,
  onFailure,
}) {
  async function load(force = false) {
    if (!force && ['loading', 'ready'].includes(getLoadState())) return false;
    onLoading();
    try {
      const url = manifestUrl();
      const manifest = await fetchManifest({ fetchWithRetry, url, operation: 'hydro-manifest', onRetry });
      if (manifest.version !== dataVersion || manifest.schema !== 'pandolab-water-shards-v5') throw new Error('수계 타일 버전이 맞지 않습니다.');
      const accepted = await acceptManifest(manifest, url);
      if (!accepted) throw new Error('수계 Worker 초기화에 실패했습니다.');
      return true;
    } catch (error) {
      onFailure(error);
      return false;
    }
  }

  return Object.freeze({ load });
}
