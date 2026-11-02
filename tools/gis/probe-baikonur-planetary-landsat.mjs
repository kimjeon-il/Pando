/** Public-domain Landsat access route via Microsoft Planetary Computer STAC and ephemeral SAS.
 * USGS owns original imagery; this returns ONLY sanitized source receipts.
 * SAS tokens, raw image bytes, and bank geometries are NEVER saved.
 */
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchBoundedJson} from './bounded-source-json.mjs';
import {TREATY_BANK_BOXES} from './probe-baikonur-government-hydrography.mjs';
import {filterUsableLandsatScenes,SCENE_WINDOW}
  from './probe-baikonur-usgs-landsat.mjs';

export const PLANETARY_COLLECTION='https://planetarycomputer.microsoft.com/api/stac/v1/collections/landsat-c2-l2/items';
export const PLANETARY_SAS='https://planetarycomputer.microsoft.com/api/sas/v1/sign';
const ensure=(ok,msg)=>{if(!ok)throw Error(msg);};
export function planetarySceneQuery(bbox){
  ensure(Array.isArray(bbox)&&bbox.length===4&&bbox.every(Number.isFinite)
    &&bbox[0]<bbox[2]&&bbox[1]<bbox[3],'Invalid treaty survey bbox');
  const url=new URL(PLANETARY_COLLECTION);
  url.search=new URLSearchParams({bbox:bbox.map(v=>v.toFixed(7)).join(','),
    datetime:SCENE_WINDOW,limit:'80'}).toString();
  return url.toString();
}
export function planetarySignQuery(assetUrl){
  const uri=new URL(assetUrl);
  ensure(uri.protocol==='https:'&&uri.hostname.endsWith('.blob.core.windows.net'),
    'Sign only ordinary Azure blob STAC image sources');
  const url=new URL(PLANETARY_SAS);
  url.search=new URLSearchParams({href:assetUrl}).toString();
  return url.toString();
}
export async function probePlanetaryBaikonur({fetcher=fetch,signal}={}){
  const out={
    schema:'pando-baikonur-public-domain-landsat-planetary-access-v1',
    origin:'USGS Landsat Collection 2 Level 2 surface reflectance',
    sourceLicense:'USGS PUBLIC DOMAIN; acknowledge USGS/NASA Landsat',
    stac:PLANETARY_COLLECTION,
    portalAccessPolicy:'https://planetarycomputer.microsoft.com/docs/concepts/sas/',
    sourceIndependence:'USGS imagery only, not OSM, Azure token discarded immediately',
    resultPhase:'SIGNED_COG_ACCESS_TEST_ONLY_NO_RIVERBANK_EXTRACTION',
    imagePixelsDownloaded:false,tokenOrSignedUrlSaved:false,
    rightBankReconstructed:false,geometryPublished:false,
    sections:[],
  };
  for(const row of TREATY_BANK_BOXES){
    signal?.throwIfAborted();
    const record={
      treatyPointPair:row.treatyPointPair,sourceQuery:planetarySceneQuery(row.bbox),
      result:'unavailable',candidateSceneCount:0,publicAssetCount:0,
      signedPixelReadTestStatus:'not-attempted',
    };
    try{
      const data=await fetchBoundedJson(record.sourceQuery,{
        fetcher,signal,timeoutMs:20000,limit:3_000_000,
        headers:{Accept:'application/geo+json, application/json',
          'User-Agent':'PandoLab-public-domain-USGS-satellite-inventory/1.0'}});
      record.scenesScanned=Array.isArray(data.features)?data.features.length:0;
      const evaluated=filterUsableLandsatScenes(data);
      record.rejections=evaluated.rejected;
      record.candidateSceneCount=evaluated.matchedInQuery;
      record.publicAssetCount=evaluated.candidates.length;
      record.candidates=evaluated.candidates.map(x=>({
        sceneId:x.sceneId,acquiredAt:x.acquiredAt,
        estimatedSceneCloudCoverPercent:x.estimatedSceneCloudCoverPercent,
        approximatePixelResolutionMeters:x.approximatePixelResolutionMeters,
        referenceGreenHttps:x.greenBandUrl,
        referenceNirHttps:x.nearInfraredBandUrl,
        referenceQaPixelHttps:x.qaPixelBandUrl,
        status:'UNSIGNED_ASSET_LINKS_NO_IMAGE_PIXELS_READ',
      }));
      record.result=evaluated.matchedInQuery?'public-domain-candidate-scenes-found':
        'no-eligible-scenes-in-metadata-sample';
      const sample=evaluated.candidates[0];
      if(sample?.greenBandUrl.endsWith('.TIF')||sample?.greenBandUrl.endsWith('.tif')){
        // A disposable SAS token tests access; never log or store it.
        const signed=await fetchBoundedJson(planetarySignQuery(sample.greenBandUrl),{
          fetcher,signal,timeoutMs:13000,limit:8000,
          headers:{Accept:'application/json'}});
        ensure(typeof signed.href==='string'
          &&signed.href.startsWith(sample.greenBandUrl+'?'),'SAS response is not scoped to selected imagery');
        const signedUri=new URL(signed.href);
        ensure(signedUri.hostname.endsWith('.blob.core.windows.net'),'Unexpected SAS destination');
        const response=await fetcher(signed.href,{
          method:'HEAD',signal,redirect:'manual',headers:{'User-Agent':'PandoLab-source-head-only/1.0'}});
        record.signedPixelReadTestStatus=response.ok?'cog-readable-head':'cog-head-unavailable';
        record.headHttpStatus=response.status;
        record.hasByteRangeSupport=response.headers.get('accept-ranges')==='bytes';
        await response.body?.cancel();
        // Do not place signed.href, response.url or token in record or logs.
      }
    }catch(error){
      if(signal?.aborted)throw error;
      record.failureClass=error.name;
      record.note='A missing STAC/SAS response does not establish missing USGS imagery.';
    }
    out.sections.push(record);
  }
  return out;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args.length!==2||args[0]!=='--output')throw Error('Usage: --output NEW_SOURCE_PROBE');
    const report=await probePlanetaryBaikonur();
    writeFileSync(resolve(args[1]),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log('PLANETARY_PUBLIC_USGS_ACCESS='+JSON.stringify({
      sourceOnly:true,sections:report.sections.map(x=>({pointPair:x.treatyPointPair,
        result:x.result,scenes:x.scenesScanned||0,eligible:x.candidateSceneCount,
        access:x.signedPixelReadTestStatus,reason:x.failureClass||null}))}));
  }catch(error){console.error(error.stack);process.exitCode=1;}
}
