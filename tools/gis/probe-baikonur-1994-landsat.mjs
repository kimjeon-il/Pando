/** Read-only 1994/1995 vs 2019/2020 Landsat 5/8/9 temporal source audit.
 * Rights: original USGS Landsat C2 L2 = US government public domain.
 * This discovers independently acquired scenes, not treaty-bank polygons.
 * No existing OSM, user-map bank geometry, raster pixels, or SAS secrets read.
 */
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchBoundedJson} from './bounded-source-json.mjs';
import {TREATY_BANK_BOXES} from './probe-baikonur-government-hydrography.mjs';
import {filterUsableLandsatScenes,USGS_REUSE_POLICY}
  from './probe-baikonur-usgs-landsat.mjs';
import {PLANETARY_COLLECTION} from './probe-baikonur-planetary-landsat.mjs';

export const HISTORIC_SCENE_YEARS=Object.freeze([1994,1995,2019,2020]);
export const HISTORIC_STAC_LIMIT=100;
const sourceUrl='https://planetarycomputer.microsoft.com/api/stac/v1/search';
const requireValue=(test,message)=>{if(!test)throw Error(message);};
export function sceneYearQuery(bbox,year,{limit=HISTORIC_STAC_LIMIT}={}){
  requireValue(HISTORIC_SCENE_YEARS.includes(year),'Unreviewed treaty year requested');
  requireValue(Array.isArray(bbox)&&bbox.length===4&&bbox.every(Number.isFinite)
    &&bbox[0]<bbox[2]&&bbox[1]<bbox[3],'Invalid official treaty bank bounds');
  requireValue(Number.isInteger(limit)&&limit>=1&&limit<=100,'STAC limit out of range');
  const u=new URL(sourceUrl);
  u.search=new URLSearchParams({
    collections:'landsat-c2-l2',
    bbox:bbox.map(n=>n.toFixed(7)).join(','),
    datetime:year+'-01-01T00:00:00Z/'+year+'-12-31T23:59:59Z',
    limit:String(limit)
  }).toString();
  return u.href;
}
const pageAllowed=(url)=>{
  const u=new URL(url);
  requireValue(u.origin==='https://planetarycomputer.microsoft.com'
    &&(u.pathname==='/api/stac/v1/search'
      ||u.pathname.startsWith('/api/stac/v1/collections/landsat-c2-l2/')),
    'Cross-domain or untrusted STAC next-page URL');
  return u.href;
};
export async function auditBaikonurHistoricSceneAvailability({fetcher=fetch,signal}={}){
  const doc={
    schema:'pando-baikonur-independent-satellite-era-review-v1',
    provider:'USGS Landsat Collection 2 Level 2 via Microsoft Planetary Computer STAC',
    sourceUrl,rightsUrl:USGS_REUSE_POLICY,
    requestedYears:HISTORIC_SCENE_YEARS,
    stage:'READ_ONLY_SCENE_INDEX_NO_PIXEL_DECODING_NO_BORDER_VALIDATION',
    leaseTreatyUrl:'https://old.adilet.zan.kz/rus/docs/U950002195_',
    originalDatumVerified:false,legalHistoricRightBankVerified:false,
    appliedPublishedGeometry:false,osmDataUsed:false,
    records:[]
  };
  for(const area of TREATY_BANK_BOXES){
    for(const year of HISTORIC_SCENE_YEARS){
      signal?.throwIfAborted?.();
      let url=sceneYearQuery(area.bbox,year);
      const row={pair:area.treatyPointPair,year,officialBbox:area.bbox,
        sourceQuery:url,status:'unavailable',pages:0,scenesScanned:0,
        totalEligible:0,reasons:[]};
      const candidates=[];
      const seenPages=new Set();
      for(let page=0;page<2;page++){
        try{
          if(seenPages.has(url))throw Error('Repeated STAC page link');
          seenPages.add(url);
          const json=await fetchBoundedJson(url,{fetcher,signal,
            timeoutMs:16000,limit:5_000_000,headers:{Accept:'application/geo+json,application/json'}});
          const scanned=Array.isArray(json.features)?json.features.length:0;
          const reviewed=filterUsableLandsatScenes(json);
          row.pages++;
          row.scenesScanned+=scanned;
          row.totalEligible+=reviewed.matchedInQuery;
          candidates.push(...reviewed.candidates);
          if(!Array.isArray(json.links))break;
          const next=json.links.find(l=>l.rel==='next'&&typeof l.href==='string');
          if(!next)break;
          url=pageAllowed(next.href);
        }catch(e){
          if(signal?.aborted)throw e;
          row.reasons.push(e.name||'Error');
          break;
        }
      }
      const unique=new Map();
      for(const c of candidates){
        if(!String(c.acquiredAt||'').startsWith(String(year)+'-'))continue;
        if(!unique.has(c.sceneId)||unique.get(c.sceneId).estimatedSceneCloudCoverPercent>
          c.estimatedSceneCloudCoverPercent)unique.set(c.sceneId,c);
      }
      const eligible=[...unique.values()].sort((a,b)=>
        a.estimatedSceneCloudCoverPercent-b.estimatedSceneCloudCoverPercent
        ||a.acquiredAt.localeCompare(b.acquiredAt));
      row.selectableScenes=eligible.length;
      row.candidates=eligible.slice(0,4).map(c=>({
        sceneId:c.sceneId,acquiredAt:c.acquiredAt,
        sceneCloudCoverPercent:c.estimatedSceneCloudCoverPercent,
        pixelSizeMeters:c.approximatePixelResolutionMeters,
        assetBands:{
          green:c.greenBandUrl,nir08:c.nearInfraredBandUrl,qa_pixel:c.qaPixelBandUrl
        },
        verifiedPixels:false,siteCloudCoverNotEstablished:true
      }));
      row.status=eligible.length?'cloud-screened-public-domain-scene-candidates':
        row.pages?'no-selected-candidate-on-sampled-pages':'source-not-available';
      row.notice='Scene-level cover is NOT riverbank cloud cover; metadata is not historic shoreline geometry.';
      doc.records.push(row);
    }
  }
  return doc;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const argv=process.argv.slice(2);
    if(argv.length!==2||argv[0]!=='--output')throw Error('Usage: --output NEW_METADATA_REPORT');
    const out=auditBaikonurHistoricSceneAvailability();
    const doc=await out;
    writeFileSync(resolve(argv[1]),JSON.stringify(doc,null,2)+'\n',{flag:'wx'});
    console.log('HISTORIC_BAIKONUR_LANDSAT='+JSON.stringify({
      records:doc.records.map(x=>({pair:x.pair,year:x.year,status:x.status,
        pages:x.pages,scanned:x.scenesScanned,eligible:x.totalEligible,
        selected:x.candidates.map(c=>c.sceneId)})),
      noLegalBankReconstruction:true
    }));
  }catch(e){console.error(e.stack);process.exitCode=1;}
}
