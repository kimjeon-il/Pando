/** Discover PUBLIC-DOMAIN USGS Landsat imagery for independent Baikonur riverbank reconstruction.
 * Read-only inventory: no raster bytes, vector geometry, or OSM content is retained.
 * Copyright basis: https://www.usgs.gov/faqs/are-landsat-data-cloud-still-considered-be-within-public-domain
 */
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchBoundedJson} from './bounded-source-json.mjs';
import {TREATY_BANK_BOXES} from './probe-baikonur-government-hydrography.mjs';

export const LANDSAT_STAC_COLLECTION='https://earth-search.aws.element84.com/v1/collections/landsat-c2-l2/items';
export const SCENE_WINDOW='2025-04-01T00:00:00Z/2026-10-01T00:00:00Z';
export const USGS_REUSE_POLICY='https://www.usgs.gov/faqs/are-landsat-data-cloud-still-considered-be-within-public-domain';
const check=(ok,message)=>{if(!ok)throw Error(message);};
const hasHttpAsset=asset=>typeof asset?.href==='string'&&/^https:\/\//i.test(asset.href);
export function makeLandsatSceneSearchUrl(bbox,{window=SCENE_WINDOW,limit=80}={}){
  check(Array.isArray(bbox)&&bbox.length===4&&bbox.every(Number.isFinite)
    &&bbox[0]<bbox[2]&&bbox[1]<bbox[3],'Expected finite geographic bounds');
  check(/^\d{4}-\d\d-\d\dT.*Z\/\d{4}-\d\d-\d\dT.*Z$/.test(window),
    'Time-window must be explicitly bounded');
  check(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'Bounded STAC limit required');
  const url=new URL(LANDSAT_STAC_COLLECTION);
  url.search=new URLSearchParams({bbox:bbox.map(x=>x.toFixed(7)).join(','),
    datetime:window,limit:String(limit)}).toString();
  return url.toString();
}
export function filterUsableLandsatScenes(document){
  check(document?.type==='FeatureCollection'&&Array.isArray(document.features),
    'Unexpected USGS Landsat STAC response');
  const candidates=[],rejected={missingAssets:0,nonPublicAssetUrl:0,cloudAbove20:0,
    notLandsatCollection:0,invalidMetadata:0};
  for(const scene of document.features){
    if(scene.collection!=='landsat-c2-l2'){rejected.notLandsatCollection++;continue;}
    const green=scene.assets?.green,nir=scene.assets?.nir08,quality=scene.assets?.qa_pixel;
    if(!green||!nir||!quality){rejected.missingAssets++;continue;}
    if(![green,nir,quality].every(hasHttpAsset)){rejected.nonPublicAssetUrl++;continue;}
    const cloud=Number(scene.properties?.['eo:cloud_cover']);
    if(!Number.isFinite(cloud)||!scene.properties?.datetime||typeof scene.id!=='string'){
      rejected.invalidMetadata++;continue;
    }
    if(cloud>20){rejected.cloudAbove20++;continue;}
    const pixelSize=Number(green['raster:bands']?.[0]?.spatial_resolution
      ||green['gsd']||scene.properties.gsd||30);
    candidates.push({
      sceneId:scene.id,acquiredAt:scene.properties.datetime,
      estimatedSceneCloudCoverPercent:cloud,
      approximatePixelResolutionMeters:pixelSize,
      greenBandUrl:green.href,nearInfraredBandUrl:nir.href,
      qaPixelBandUrl:quality.href,
      classification:'STAC_DISCOVERY_ONLY_IMAGE_PIXELS_NOT_ANALYZED',
      waterMaskAlgorithm:'NDWI (Green - NIR) / (Green + NIR), with QA_PIXEL cloud mask',
    });
  }
  candidates.sort((a,b)=>a.estimatedSceneCloudCoverPercent-b.estimatedSceneCloudCoverPercent
    ||b.acquiredAt.localeCompare(a.acquiredAt)||a.sceneId.localeCompare(b.sceneId));
  return {candidates:candidates.slice(0,5),matchedInQuery:candidates.length,rejected};
}
export async function probePublicDomainBaikonurScenes({fetcher=fetch,signal}={}){
  const result={
    schema:'pando-baikonur-usgs-landsat-independent-bank-source-v1',
    sourceProvider:'US Geological Survey Landsat C2 L2 via Earth Search STAC index',
    stac:LANDSAT_STAC_COLLECTION,reuseRights:'USGS public domain; source acknowledgment requested',
    reusePolicyUrl:USGS_REUSE_POLICY,
    sourceIndependence:'USGS/NASA remote-sensing pixels. No OpenStreetMap source or coordinates.',
    officialRightBankSource:'1994 Kazakhstan lease coordinates in tools/gis/baikonur-official-reference.mjs',
    sourceTimeWindow:SCENE_WINDOW,
    phase:'DISCOVERY_ONLY_NOT_APPROVED_FOR_GEOMETRY',
    shorelineDigitized:false,seasonalWaterExtentConfirmed:false,
    treatyRiverbankIdentified:false,geometryCopiedIntoPublishedMap:false,
    bankSections:[],
  };
  for(const area of TREATY_BANK_BOXES){
    signal?.throwIfAborted();
    const url=makeLandsatSceneSearchUrl(area.bbox),row={
      officialTreatyPointPair:area.treatyPointPair,
      queryBbox:area.bbox,sourceQuery:url,status:'unavailable',
    };
    try {
      const value=await fetchBoundedJson(url,{fetcher,signal,timeoutMs:22000,limit:3_000_000,
        headers:{Accept:'application/geo+json, application/json',
          'User-Agent':'PandoLab-independent-USGS-riverbank-audit/1.0'}});
      row.rawStacSceneCount=Array.isArray(value?.features)?value.features.length:null;
      row.sampleAssetKeys=Array.isArray(value?.features)&&value.features.length
        ?Object.keys(value.features[0].assets||{}).slice(0,20):[];
      row.sampleGreenHrefScheme=value?.features?.[0]?.assets?.green?.href?.split(':')?.[0]||null;
      const screened=filterUsableLandsatScenes(value);
      Object.assign(row,screened);
      row.status=screened.matchedInQuery?'public-domain-scenes-discovered'
        :'no-eligible-public-https-scene-in-sample';
      row.notice='Scene cloud cover is whole-scene, not proof that this riverbank is cloud free.';
    }catch(error){
      if(signal?.aborted)throw error;
      row.errorClass=error.name;
      row.notice='STAC query failure is not evidence of missing USGS imagery.';
    }
    result.bankSections.push(row);
  }
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const argv=process.argv.slice(2);
    if(argv.length!==2||argv[0]!=='--output')throw Error('Use --output NEW_SCENE_INVENTORY');
    const data=await probePublicDomainBaikonurScenes();
    writeFileSync(resolve(argv[1]),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
    console.log('BAIKONUR_PUBLIC_DOMAIN_LANDSAT='+JSON.stringify({
      bankSections:data.bankSections.map(row=>({pair:row.officialTreatyPointPair,
        status:row.status,scenes:row.matchedInQuery||0,
        rawScenes:row.rawStacSceneCount||0,rejected:row.rejected||{},
        greenScheme:row.sampleGreenHrefScheme||null,
        selected:row.candidates?.map(x=>x.sceneId)||[]})),
      rights:data.reuseRights,sourceOnly:true,
    }));
  }catch(error){console.error(error.stack);process.exitCode=1;}
}
