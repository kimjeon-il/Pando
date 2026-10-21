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
  if (meta.publicReleaseManifestSha256) {
    url.searchParams.set('publicationRevision', meta.dataRevision);
    url.searchParams.set('publicationManifestSha256', meta.publicReleaseManifestSha256);
  }
  return url;
}
