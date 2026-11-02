// Assemble one source region without writing runtime packs or source data.
import {buildHydroSelectedReaches} from './hydro-connectivity-native.mjs';
import {selectHydroSourceTopology} from './hydro-source-selection.mjs';
import {classifyHydroTerminalReaches} from './hydro-outlets.mjs';
import {assembleHydroCanonicalChains,matchHydroReferenceNames} from './hydro-reference-guides.mjs';
import {findHydroSharedCountryBorders} from './hydro-point-screen-native.mjs';
import {alignHydroBorderChains} from './hydro-border-alignment.mjs';
import {normalizeHydroChains} from './hydro-chain-normalization.mjs';
import {normalizeHydroNetwork} from './hydro-network-normalization.mjs';

export async function prepareHydroRegion({selection,reader,references,countries,borders:providedBorders,lakes,sampleWater,region}={},options={}){
  options.signal?.throwIfAborted();if(!selection||selection.region!==region||!reader||!Array.isArray(references)||
    !Array.isArray(countries)||!countries.length||!Array.isArray(lakes)||typeof sampleWater!=='function')
    throw Error('Explicit matching Hydro region and source inputs required');
  const pointScreen={...options.pointScreen},connectivity={...options.connectivity};
  if(options.signal){pointScreen.signal=options.signal;connectivity.signal=options.signal;}
  const topology=await selectHydroSourceTopology({selection,reader,references},{pointScreen,signal:options.signal});
  const selected=await buildHydroSelectedReaches({selection,reader,selected:new Set(topology.ids)},connectivity);
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];for(const reach of selected)for(const part of reach.parts)for(const point of part){
    let lon=((point[0]+180)%360+360)%360-180;if(lon===-180)lon=180;
    bounds[0]=Math.min(bounds[0],lon);bounds[1]=Math.min(bounds[1],point[1]);bounds[2]=Math.max(bounds[2],lon);bounds[3]=Math.max(bounds[3],point[1]);}
  if(bounds.some(value=>!Number.isFinite(value)))throw Error('Hydro region has no selected source coordinates');
  const terminal=await classifyHydroTerminalReaches({reaches:selected,land:countries.map(row=>row.geometry),lakes,sampleWater},
    {pointScreen,connectivity,signal:options.signal});
  const raw={},byId=new Map(),sourceOrder=[];for(const reach of terminal.reaches){sourceOrder.push(reach.id);byId.set(reach.id,reach);
    raw[reach.id]={region,next:reach.next,start:reach.parts[0][0],end:reach.parts.at(-1).at(-1)};}
  const ids=await assembleHydroCanonicalChains({reaches:terminal.reaches,references},{pointScreen,connectivity,signal:options.signal});
  const chains=ids.map(chain=>chain.map(id=>byId.get(id)));
  const neNames=await matchHydroReferenceNames({chains,references,bounds},pointScreen);
  const borders=providedBorders??await findHydroSharedCountryBorders(countries,pointScreen);
  if(!Array.isArray(borders))throw Error('Invalid prepared Hydro shared borders');
  const aligned=await alignHydroBorderChains({chains,borders},{pointScreen,connectivity,signal:options.signal});
  const normalized=await normalizeHydroChains({chains:aligned.chains,borders},{pointScreen,connectivity,signal:options.signal});
  const repaired=await normalizeHydroNetwork({chains:normalized.chains,raw,sourceOrder,region},connectivity);
  for(const chain of repaired.chains){if(!chain.length)continue;const last=chain.at(-1),chainIds=new Set(chain.map(row=>row.id));
    if(last.next&&!chainIds.has(last.next)){last.terminalClass='confluence';last.originalEndpoint=structuredClone(raw[last.id].end);}}
  return {chains:repaired.chains,neNames,bounds,borders,borderStats:aligned.stats,
    stats:{...topology.stats,selectedReachCount:terminal.reaches.length,
      continuityReachCount:Math.max(0,terminal.reaches.length-topology.stats.seedReachCount),...terminal.stats},
    connectionChangedCount:normalized.changed,junctionReport:{changedPorts:repaired.changedPorts,changes:repaired.changes,remaining:repaired.remaining}};
}
