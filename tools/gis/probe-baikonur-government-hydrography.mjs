/** Read-only search of independent Kazakh government geodata near Baikonur's two riverbank arcs.
 * This does not download, copy, trace, or license any replacement geometry.
 * Publication requires a separately verified source licence, ownership and topology.
 */
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchBoundedJson,fetchBoundedBytes} from './bounded-source-json.mjs';
import {ANCHORS,UNRESOLVED_BANKS,decimalDegrees} from './baikonur-official-reference.mjs';

const PREFIX='https://gis.kgp.kz/arcgis/rest/services/KPSSU/Base_map_/FeatureServer';
export const OFFICIAL_BASE_MAP='https://map.gov.kz/geoserver/web/';
export const SURVEYING_PROVIDER='https://gis.kgp.kz/arcgis/rest/services/KPSSU/Base_map_/MapServer';
export const HYDROGRAPHY_LAYER_IDS=Object.freeze([8,9]); // polygonal water + line rivers
const fixedArea=([a,b],pad=.045)=>{
  const first=ANCHORS[a-1],second=ANCHORS[b-1];
  const x=[decimalDegrees(first[1]),decimalDegrees(second[1])],
    y=[decimalDegrees(first[0]),decimalDegrees(second[0])];
  return [Math.min(...x)-pad,Math.min(...y)-pad,Math.max(...x)+pad,Math.max(...y)+pad];
};
export const TREATY_BANK_BOXES=Object.freeze(UNRESOLVED_BANKS.map(pair=>({
  treatyPointPair:pair,bbox:fixedArea(pair),
})));
export function governmentBaikonurQuery({layerId,bbox}){
  if(!HYDROGRAPHY_LAYER_IDS.includes(layerId)
    ||!Array.isArray(bbox)||bbox.length!==4
    ||!bbox.every(Number.isFinite)||bbox[0]>=bbox[2]||bbox[1]>=bbox[3])throw Error('Unsafe government source scope');
  const params=new URLSearchParams({
    where:'1=1',
    geometry:bbox.map(v=>v.toFixed(7)).join(','),
    geometryType:'esriGeometryEnvelope',
    spatialRel:'esriSpatialRelIntersects',inSR:'4326',
    outFields:'objectid,name,name_kk,usl',
    returnGeometry:'false',resultRecordCount:'200',f:'json',
  });
  return PREFIX+'/'+layerId+'/query?'+params;
}
export async function probeBaikonurGovernmentHydrography({fetcher=fetch,signal}={}){
  const out={
    schema:'pando-baikonur-government-bank-hydrography-probe-v1',
    scope:'1994 lease plot 1 treaty right-bank sections 17-18 and 31-1',
    leaseSource:'https://old.adilet.zan.kz/rus/docs/U950002195_',
    sourceProvider:SURVEYING_PROVIDER,
    rights:'UNVERIFIED: ArcGIS service advertises copyright КПСиСУ. Published web access is not a reuse license.',
    geometryExported:false,geometryApproved:false,
    geometryCopiedIntoPublishedMap:false,
    maps:[],
  };
  for(const row of TREATY_BANK_BOXES){
    for(const layerId of HYDROGRAPHY_LAYER_IDS){
      signal?.throwIfAborted();
      const url=governmentBaikonurQuery({layerId,bbox:row.bbox});
      const receipt={treatyPointPair:row.treatyPointPair,layerId,url,status:'unavailable'};
      try {
        const data=await fetchBoundedJson(url,{fetcher,signal,timeoutMs:14000,limit:350000,
          headers:{Accept:'application/json','User-Agent':'PandoLab-source-verification/1.0'}});
        if(data?.error||!Array.isArray(data.features))throw Error('Government feature response unusable');
        const names=[...new Set(data.features
          .map(item=>String(item.attributes?.name||item.attributes?.name_kk||'').trim())
          .filter(Boolean))].sort();
        receipt.status='candidate-attributes-received';
        receipt.featureCount=data.features.length;
        receipt.exceededTransferLimit=Boolean(data.exceededTransferLimit);
        receipt.names=names.slice(0,24);
        receipt.geometryRetained=false;
        receipt.independentProvenanceUnverified=true;
      }catch(error){
        if(signal?.aborted)throw error;
        receipt.failureClass=error.name;
        receipt.note='Service failure is not evidence that government shoreline data is absent';
      }
      out.maps.push(receipt);
    }
  }
  return out;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args.length!==2||args[0]!=='--output')throw Error('Use --output NEW_READONLY_RECEIPT');
    const result=await probeBaikonurGovernmentHydrography();
    writeFileSync(resolve(args[1]),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log('OFFICIAL_BAIKONUR_HYDRO_PROBE='+JSON.stringify(result));
  }catch(error){console.error(error.stack);process.exitCode=1;}
}
