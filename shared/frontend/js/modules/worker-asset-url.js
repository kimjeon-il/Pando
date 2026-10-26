/** Resolve only generated immutable Worker entries; missing build wiring is fatal. */
export function workerAssetUrl(value, meta = globalThis.PANDOLAB_BUILD_META) {
  const original = new URL(value);
  const marker = '/assets/js/';
  const offset = original.pathname.lastIndexOf(marker);
  const path = offset < 0 ? '' : original.pathname.slice(offset + 1);
  const asset = meta?.workerAssets?.[path];
  if (!asset || !/^assets\/worker-runtime\/[a-f0-9]{32}\/assets\/js\/workers\/[\w-]+\.js$/.test(asset.url)) {
    throw Object.assign(new Error(`Missing immutable Worker asset: ${path || original.pathname}`), { code: 'PL-WORKER-ASSET' });
  }
  const base = new URL(original.href);
  base.pathname = original.pathname.slice(0, offset + 1); base.search = ''; base.hash = '';
  const url = new URL(asset.url, base);
  url.searchParams.set('v', meta.assetRevision);
  for (const [key, parameter] of original.searchParams) if (key !== 'v') url.searchParams.set(key, parameter);
  if (!meta.dataRevision) throw new Error('Missing Worker data revision');
  url.searchParams.set('dataRevision', meta.dataRevision);
  return url;
}

export function runtimeDataRoot(scriptUrl) {
  const url = new URL(scriptUrl), offset = url.pathname.indexOf('/assets/');
  if (offset < 0) throw new Error('Missing runtime asset root');
  url.pathname = url.pathname.slice(0, offset + 1); url.search = ''; url.hash = '';
  return url;
}

export function runtimeDataAssetUrl(scriptUrl, asset) {
  if (typeof asset?.url !== 'string' || !asset.url.startsWith('assets/data/')
    || /(?:\.\.|[?\\#])/.test(asset.url) || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new Error('Invalid runtime data asset');
  }
  const url = new URL(asset.url, runtimeDataRoot(scriptUrl));
  url.searchParams.set('sha256', asset.sha256);
  return url;
}

export function workerBuildMeta(scriptUrl, meta) {
  const params = new URL(scriptUrl).searchParams;
  if (!meta?.assetRevision || !meta.dataRevision
    || params.get('v') !== meta.assetRevision || params.get('dataRevision') !== meta.dataRevision) {
    throw new Error('Worker build/data revision mismatch; reload the application');
  }
  return meta;
}
