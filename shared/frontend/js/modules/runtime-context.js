/** Immutable execution configuration; project and resource state remain elsewhere. */
export function validateBuildMetadata(meta){
  for(const key of ['appVersion','buildId','assetRevision','dataRevision']){
    if(typeof meta?.[key]!=='string'||!meta[key].trim())throw new TypeError('Build metadata requires '+key);
  }
  return Object.freeze(meta);
}

export function versionedAssetUrl(relative,assetBaseUrl,assetRevision){
  if(typeof assetRevision!=='string'||!assetRevision)throw new TypeError('Asset revision is required.');
  const url=new URL(relative,assetBaseUrl);url.searchParams.set('v',assetRevision);return url;
}

export function createRuntimeContext({productMode,meta,assetBaseUrl,platform={}}={}){
  if(!['viewer','editor'].includes(productMode))throw new TypeError('Explicit runtime product mode is required.');
  validateBuildMetadata(meta);
  const base=new URL(assetBaseUrl).href;
  if(!platform||typeof platform!=='object')throw new TypeError('Runtime platform ports are required.');
  return Object.freeze({productMode,meta,platform:Object.freeze({...platform}),assetBaseUrl:base,
    assetUrl:relative=>versionedAssetUrl(relative,base,meta.assetRevision)});
}
