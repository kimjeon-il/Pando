import {scoreHydroFeaturePolicies} from './hydro-connectivity-native.mjs';
import {hydroGeometryBounds} from './hydro-encoding-native.mjs';
import {normalizeHydronym} from './hydronym-normalize.mjs';
import {pythonRound} from './hydro-numeric.mjs';

export async function buildHydroLakeFeatures({lakes,aliases,fidStart=0,logicalFidStart=0}={},options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(lakes)||!aliases||typeof aliases!=='object'||Array.isArray(aliases)||
    !Number.isSafeInteger(fidStart)||fidStart<0||!Number.isSafeInteger(logicalFidStart)||logicalFidStart<0)
    throw Error('Explicit Natural Earth lakes, aliases and starting IDs required');
  const input=[];for(let index=0;index<lakes.length;index++){const row=lakes[index],type=row?.geometry?.type;
    if(type!=='Polygon'&&type!=='MultiPolygon')continue;const properties=row.properties||{},zoom=Number(properties.min_zoom||7.5);
    if(!Number.isFinite(zoom))throw Error('Invalid Natural Earth lake zoom');input.push({row,properties,index,zoom});}
  const policies=[];for(let at=0;at<input.length;at+=100000)policies.push(...await scoreHydroFeaturePolicies(input.slice(at,at+100000).map(row=>
    ({order:0,flow:0,upstreamArea:0,lakeArea:0,zoom:row.zoom})),options));
  let fid=fidStart,logicalFid=logicalFidStart;const features=input.map((item,index)=>{const {row,properties}=item,
    sourceId=String(properties.source_id||row.id||item.index),awId=String(properties.pandolab_id||row.id||`lakes_base:${sourceId}`),
    name=normalizeHydronym(String(properties.name_ko||properties.name_en||properties.name||''),'lake',aliases),geometry=structuredClone(row.geometry);
    return {metadata:{fid:fid++,logicalFid:logicalFid++,awId,layerId:'lakes_natural_earth',category:'lake',stage:policies[index].minZoomStage,
      name,sourceId,source:'Natural Earth 5.0.0 1:10m',width:1,bounds:hydroGeometryBounds(geometry).map(value=>pythonRound(value*1000000,0)),
      fragmentIndex:0,fragmentCount:1,flags:0},geometry,widths:null};});
  return {features,nextFid:fid,nextLogicalFid:logicalFid};
}
