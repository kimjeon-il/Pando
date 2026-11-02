// Classify selected source terminals before excluding invalid upstream basins.
import {classifyHydroOutlets,excludeHydroInvalidTerminalBasins} from './hydro-connectivity-native.mjs';
import {observeHydroOutlets} from './hydro-point-screen-native.mjs';
import {pythonRound} from './hydro-numeric.mjs';

export function createHydroWaterRasterSampler({width,height,data}={}){
  if(!Number.isSafeInteger(width)||width<1||!Number.isSafeInteger(height)||height<1||
    !(data instanceof Uint8Array)||data.length!==width*height*4)throw Error('Explicit RGBA Hydro water raster required');
  return async points=>{
    if(!Array.isArray(points)||points.some(point=>!Array.isArray(point)||point.length!==2||
      point.some((value,i)=>!Number.isFinite(value)||Math.abs(value)>(i===0?180:90))))throw Error('Invalid Hydro water sample point');
    return points.map(([longitude,latitude])=>{
      let lon=((longitude+180)%360+360)%360-180;if(lon===-180)lon=180;
      const x=Math.min(width-1,Math.max(0,Math.trunc((lon+180)/360*width))),
        y=Math.min(height-1,Math.max(0,Math.trunc((90-latitude)/180*height))),at=(y*width+x)*4;
      const rgb=[data[at],data[at+1],data[at+2]];return Math.max(...rgb)-Math.min(...rgb)<=1&&Math.min(...rgb)>=249;
    });
  };
}
export async function classifyHydroTerminalReaches({reaches,land,lakes,sampleWater}={},options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(reaches)||reaches.length>1000000||!Array.isArray(land)||!land.length||!Array.isArray(lakes)||typeof sampleWater!=='function')
    throw Error('Explicit Hydro reaches, rendered land, lakes and water sampler required');
  const copy=structuredClone(reaches),ids=new Set();
  for(const row of copy){if(!Number.isSafeInteger(row?.id)||row.id<=0||!Number.isSafeInteger(row.next)||row.next<0||ids.has(row.id)||
    typeof row.endorheic!=='boolean'||!Array.isArray(row.originalEndpoint)||row.originalEndpoint.length!==2||
    row.originalEndpoint.some((value,i)=>!Number.isFinite(value)||Math.abs(value)>(i===0?180:90)))throw Error('Invalid Hydro terminal reach');
    ids.add(row.id);row.terminalClass=null;row.renderSnap=null;}
  const terminal=copy.filter(row=>!row.next&&!row.endorheic),points=terminal.map(row=>row.originalEndpoint);
  const geometryOptions={...options.pointScreen},connectivityOptions={...options.connectivity};
  if(options.signal){geometryOptions.signal=options.signal;connectivityOptions.signal=options.signal;}
  const observations=[];for(let at=0;at<points.length;at+=10000)
    observations.push(...await observeHydroOutlets({land,lakes,points:points.slice(at,at+10000)},geometryOptions));
  const water=await sampleWater(points);
  options.signal?.throwIfAborted();if(!Array.isArray(water)||water.length!==points.length||water.some(value=>typeof value!=='boolean'))
    throw Error('Hydro water sampler returned invalid observations');
  const decisions=[];for(let at=0;at<terminal.length;at+=100000){const batch=observations.slice(at,at+100000).map((row,i)=>
    ({...row,undisplayedWater:water[at+i],maxKm:25}));decisions.push(...await classifyHydroOutlets(batch,connectivityOptions));}
  const byId=new Map(terminal.map((row,index)=>[row.id,decisions[index]])),counts={},excludedSources=[];let snapped=0;
  const add=key=>{counts[key]=(counts[key]||0)+1;};
  for(const row of copy){if(row.next)continue;
    if(row.endorheic){row.terminalClass='endorheic';add('endorheic');continue;}
    const decision=byId.get(row.id);row.terminalClass=decision.class;row.renderSnap=decision.snap;add(row.terminalClass);
    if(row.renderSnap!==null)snapped++;
    if(row.terminalClass==='unresolved-land'){counts['unresolved-land']--;row.terminalClass='excluded-unresolved-source-terminal';add(row.terminalClass);}
    if(['excluded-small-land','excluded-undisplayed-water','excluded-unresolved-source-terminal'].includes(row.terminalClass))
      excludedSources.push({sourceId:row.id,class:row.terminalClass,distanceKm:pythonRound(decision.distanceKm,3),endpoint:row.originalEndpoint});
  }
  const exclusion=await excludeHydroInvalidTerminalBasins(copy.map(row=>({id:row.id,next:row.next,terminalClass:row.terminalClass})),connectivityOptions);
  const kept=new Set(exclusion.kept);
  return {reaches:copy.filter(row=>kept.has(row.id)),stats:{coastSnappedTerminalCount:snapped,terminalClassCounts:counts,
    excludedTerminalSources:excludedSources,excludedTerminalReachCount:exclusion.excluded.length}};
}
