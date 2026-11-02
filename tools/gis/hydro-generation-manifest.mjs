import {pythonRound} from './hydro-numeric.mjs';

export function buildHydroGenerationManifest({layout,stats,sourceRows,source,namedSystems,unnamedSystems,osmMatches}={}){
  if(!layout?.index?.sha256||!stats||!Array.isArray(sourceRows)||!source||
    [namedSystems,unnamedSystems,osmMatches].some(value=>!Number.isSafeInteger(value)||value<0))
    throw Error('Explicit Hydro generation layout, source receipts and name counts required');
  const totals={...stats};for(const key of ['seedReachCount','continuityRootCount','namedContinuityRootCount','mediumMainstemRootCount',
    'mediumMainstemReachCount','selectedReachCount','continuityReachCount','downstreamClosureReachCount','coastSnappedTerminalCount',
    'excludedTerminalReachCount','borderAlignedReachCount','borderAlignedRiverCount','borderChangedCoordinateCount','connectionChangedCount'])
    totals[key]=sourceRows.reduce((sum,row)=>sum+(row[key]||0),0);
  totals.terminalClassCounts={};for(const row of sourceRows)for(const [key,value] of Object.entries(row.terminalClassCounts||{}))
    totals.terminalClassCounts[key]=(totals.terminalClassCounts[key]||0)+value;
  totals.borderAlignedLengthKm=pythonRound(sourceRows.reduce((sum,row)=>sum+(row.borderAlignedLengthKm||0),0),1);
  totals.riverSystemCount=sourceRows.reduce((sum,row)=>sum+(row.systemCount||0),0);totals.namedRiverSystemCount=namedSystems;
  totals.unnamedRiverSystemCount=unnamedSystems;totals.osmWaterwayMatchCount=osmMatches;
  return {version:'0.13.1',schema:'pandolab-water-shards-v5',
    dataset:'HydroRIVERS 1.0 systems · OSM waterway names · Natural Earth 5.0.0 1:10m lakes · Natural Earth 5.1.1 border alignment',crs:'EPSG:4326',
    coordinatePolicy:'Hydro source vertices retained outside border-aligned display fragments; aligned fragments use exact Natural Earth shared-border paths; 1e-6 degree Int32 delta-varint',
    selection:{riverFormula:'ORD_STRA + 4*log10(DIS_AV_CMS) - 0.5*log10(UPLAND_SKM)',riverThresholds:[14.4744,12.4307,11.2137,10.55],
      riverWidthFormula:'clamp(0.5 + 0.19*log2(1+DIS_AV_CMS) + 0.06*(ORD_STRA-1), 0.55, 2.6)',
      riverContinuity:'Natural Earth guided Hydro main-stem path to headwater from selected headward roots; with ORD_STRA >= 5 and DIS_AV_CMS >= 75; importance >= 10.86; all terminal basins >= 2500 km2 preserve one main stem; all selected paths closed downstream to Hydro terminal; added reaches at stage 3',
      logicalGrouping:'all displayed MAIN_RIV main-stem and tributary chains share one system ID',mediumMainstemMinBasinKm2:2500,
      borderAlignment:{revision:2,maxDistanceKm:12,coverageDistanceKm:5,minCoverage:.70,maxDirectionDegrees:30,minLengthKm:10,
        scope:'built-in Natural Earth shared country borders only'},
      terminalConnectivity:{revision:2,classes:['sea','lake','confluence','endorheic'],maximumCoastExtensionKm:25,requiresLandContainedConnector:true,
        unresolvedRenderedLandTerminal:'repair source graph or exclude the affected logical river before packing',
        undisplayedRasterWaterTerminal:'logical river excluded and reported'},
      lakeSelection:'Natural Earth 5.0.0 1:10m global lakes and reservoirs; no regional supplements',minZoomStages:[6,6.7,7,7.5]},
    stages:[[8,4],[16,8],[32,16],[64,32]].map(([columns,rows],id)=>({id,minZoom:[6,6.7,7,7.5][id],columns,rows})),
    format:{pack:4,index:4,metadata:5,fragmentLogicalIds:true,riverSystemIds:true,featureFlags:{borderAligned:1}},
    index:layout.index,metadata:layout.metadata,shards:layout.shards,
    cache:{name:`pandolab-water-v0.13.1-${layout.index.sha256.slice(0,12)}`,backgroundDownload:true,rangeRequests:true},
    layers:[{id:'rivers_hydro',category:'river',label:'강 · Hydro',locked:true},
      {id:'lakes_natural_earth',category:'lake',label:'호수 · Natural Earth',locked:true}],stats:totals,
    sources:{naturalEarthNameReference:source.naturalEarthNameReference,drainageFreeWaterMask:source.drainageFreeWaterMask,
      hydroRivers:sourceRows,naturalEarthLakes:source.naturalEarthLakes,osmWaterways:source.osmWaterways,
      hydronymOverrides:source.hydronymOverrides,independentHydronymReplacements:source.independentHydronymReplacements,
      nameEnrichment:{namedRiverSystems:namedSystems,unnamedRiverSystems:unnamedSystems,osmMatches}}};
}
