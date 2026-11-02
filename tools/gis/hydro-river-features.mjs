// Build private Hydro river features from reviewed source-region chains.
import {assembleHydroSystemFragments,buildHydroFragmentGeometries,buildHydroRiverSystems} from './hydro-connectivity-native.mjs';
import {normalizeHydroChains} from './hydro-chain-normalization.mjs';
import {nameHydroSystems} from './hydro-system-names.mjs';
import {hydroGeometryBounds} from './hydro-encoding-native.mjs';
import {pythonRound} from './hydro-numeric.mjs';

export async function buildHydroRiverFeatures({chains,borders,neNames,aliases,systemOverrides,independentDocument,osmRows,
  fidStart=0,logicalFidStart=0}={},options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(chains)||!Array.isArray(borders)||!Number.isSafeInteger(fidStart)||fidStart<0||
    !Number.isSafeInteger(logicalFidStart)||logicalFidStart<0)throw Error('Explicit Hydro river chains and starting IDs required');
  const connectivity={...options.connectivity},pointScreen={...options.pointScreen};
  if(options.signal){connectivity.signal=options.signal;pointScreen.signal=options.signal;}
  const layout=await buildHydroRiverSystems({chains},connectivity),chainGeometries=[];
  for(let at=0;at<chains.length;at+=1000)chainGeometries.push(...await buildHydroFragmentGeometries(chains.slice(at,at+1000),connectivity));
  const chainBounds=Object.fromEntries(chainGeometries.map((geometry,index)=>[index,hydroGeometryBounds(geometry)]));
  const names=await nameHydroSystems({systems:layout.systems,neNames,aliases,systemOverrides,independentDocument,osmRows,chainBounds},pointScreen),
    bySystem=new Map(names.map(row=>[row.systemId,row.name])),fragments=[];
  for(let i=0;i<chains.length;i++){let offset=0;for(const ids of layout.fragments[i]){
    fragments.push({chainIndex:i,reaches:chains[i].slice(offset,offset+ids.length)});offset+=ids.length;}}
  const normalized=await normalizeHydroChains({chains:fragments.map(row=>row.reaches),borders},{pointScreen,connectivity,signal:options.signal});
  const normalizedChains=chains.map(()=>[]);for(let i=0;i<fragments.length;i++)normalizedChains[fragments[i].chainIndex].push(...normalized.chains[i]);
  const systems=await assembleHydroSystemFragments({chains:normalizedChains},connectivity),features=[],appliedIndependent=[];
  let fid=fidStart,logicalFid=logicalFidStart,namedSystems=0,osmMatches=0;
  for(const system of systems){const name=bySystem.get(system.systemId);if(!name)throw Error('Hydro system name missing');
    if(name.nameEnriched)namedSystems++;if(name.osmRelationIds.length)osmMatches++;if(name.independent)appliedIndependent.push(String(system.systemId));
    const offsets=new Map();for(let index=0;index<system.fragments.length;index++){const fragment=system.fragments[index],offset=offsets.get(fragment.chainIndex)||0,
      reaches=normalizedChains[fragment.chainIndex].slice(offset,offset+fragment.reachIds.length);offsets.set(fragment.chainIndex,offset+reaches.length);
      if(!reaches.length)throw Error('Hydro feature fragment is empty');const first=reaches[0],last=reaches.at(-1),pair=first.borderPair;
      const values=fragment.widths.flat(),width=values.length?values.reduce((max,value)=>Math.max(max,value),-Infinity):first.width;
      const source=pair?`HydroRIVERS 1.0 · Natural Earth border ${pair.join('/')}`:
        name.osmRelationIds.length?'HydroRIVERS 1.0 · OSM waterway names':'HydroRIVERS 1.0';
      const metadata={fid:fid++,logicalFid,awId:`hydro-system:${system.systemId}`,layerId:'rivers_hydro',category:'river',stage:first.stage,
        name:name.displayName,sourceId:fragment.reachIds.join(','),source,width,
        bounds:hydroGeometryBounds(fragment.geometry).map(value=>pythonRound(value*1000000,0)),fragmentIndex:index,
        fragmentCount:system.fragments.length,flags:pair?1:0,systemId:String(system.systemId),mainstemNameKo:name.displayName,
        role:fragment.chainIndex===system.mainstemIndex?'mainstem':'tributary'};
      if(index===0){metadata.aliases=name.aliases;metadata.tributaryNames=name.tributaryNames;
        if(name.osmRelationIds.length)metadata.osmRelationIds=name.osmRelationIds;}
      if(last.terminalClass)metadata.terminal={class:last.terminalClass,sourceEndpoint:structuredClone(last.originalEndpoint??last.parts.at(-1).at(-1)),
        renderEndpoint:structuredClone(last.renderSnap??last.parts.at(-1).at(-1))};
      features.push({metadata,geometry:fragment.geometry,widths:fragment.widths});}
    logicalFid++;}
  return {features,nextFid:fid,nextLogicalFid:logicalFid,chainCount:chains.length,systemCount:systems.length,namedSystems,osmMatches,
    appliedIndependent,connectionChangedCount:normalized.changed};
}
