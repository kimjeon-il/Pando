// Assemble source-bound Hydro packs in memory; publication remains separate.
import {findHydroSharedCountryBorders} from './hydro-point-screen-native.mjs';
import {openHydroRiverShapeReader} from './hydro-source-reader.mjs';
import {withHydroSourceSelection} from './hydro-connectivity-native.mjs';
import {prepareHydroRegion} from './hydro-region-pipeline.mjs';
import {buildHydroRiverFeatures} from './hydro-river-features.mjs';
import {buildHydroLakeFeatures} from './hydro-lake-features.mjs';
import {validateIndependentHydronyms} from './hydro-independent-name-policy.mjs';
import {encodeHydroRepairPlan} from './hydro-encoding-native.mjs';
import {buildHydroPack} from './hydro-pack-layout.mjs';
import {buildHydroGenerationManifest} from './hydro-generation-manifest.mjs';

export async function generateHydroFromSources({sources,countries,references,lakes,sampleWater,aliases,systemOverrides,
  independentDocument,osmRows,source}={},options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(sources)||!sources.length||!Array.isArray(countries)||!countries.length||
    !Array.isArray(references)||!Array.isArray(lakes)||typeof sampleWater!=='function'||!Array.isArray(osmRows)||!source)
    throw Error('Explicit Hydro generation sources and references required');
  const codes=sources.map(item=>item?.specification?.datasetCode);
  if(codes.some(code=>typeof code!=='string')||new Set(codes).size!==codes.length)throw Error('Unique Hydro generation regions required');
  const expectedIndependent=validateIndependentHydronyms(structuredClone(independentDocument)),pointScreen={...options.pointScreen},
    connectivity={...options.connectivity},encoding={...options.encoding};
  if(options.signal){pointScreen.signal=options.signal;connectivity.signal=options.signal;encoding.signal=options.signal;}
  const borders=await findHydroSharedCountryBorders(countries,pointScreen),features=[],sourceRows=[],applied=new Set();
  let fid=0,logicalFid=0,namedSystems=0,unnamedSystems=0,osmMatches=0;
  for(const item of sources){options.signal?.throwIfAborted();if(!Array.isArray(item.sourceFiles))throw Error('Hydro source file receipts required');
    const reader=await openHydroRiverShapeReader(item.files,{signal:options.signal});
    try{await withHydroSourceSelection({files:item.files,specification:item.specification},async selection=>{
      const region=await prepareHydroRegion({selection,reader,references,countries,borders,lakes:lakes.map(row=>row.geometry),sampleWater,
        region:item.specification.datasetCode},{pointScreen,connectivity,signal:options.signal});
      const rivers=await buildHydroRiverFeatures({chains:region.chains,borders,neNames:region.neNames,aliases,systemOverrides,
        independentDocument,osmRows,fidStart:fid,logicalFidStart:logicalFid},{pointScreen,connectivity,signal:options.signal});
      for(const feature of rivers.features)features.push(feature);fid=rivers.nextFid;logicalFid=rivers.nextLogicalFid;namedSystems+=rivers.namedSystems;
      unnamedSystems+=rivers.systemCount-rivers.namedSystems;osmMatches+=rivers.osmMatches;
      for(const id of rivers.appliedIndependent)applied.add(id);
      sourceRows.push({datasetCode:item.specification.datasetCode,files:structuredClone(item.sourceFiles),...region.stats,...region.borderStats,
        connectionChangedCount:region.connectionChangedCount+rivers.connectionChangedCount,chainCount:rivers.chainCount,
        systemCount:rivers.systemCount,nameMatches:rivers.namedSystems,osmMatches:rivers.osmMatches});
      await options.onRegion?.({code:item.specification.datasetCode,chains:rivers.chainCount,systems:rivers.systemCount});
    },connectivity);}finally{await reader.close();}}
  const missing=Object.keys(expectedIndependent).filter(id=>!applied.has(id)).sort();
  if(missing.length)throw Error('Independent hydronym systems missing from HydroRIVERS: '+missing.join(', '));
  const lakeFeatures=await buildHydroLakeFeatures({lakes,aliases,fidStart:fid,logicalFidStart:logicalFid},connectivity);
  for(const feature of lakeFeatures.features)features.push(feature);const changedFeatureIds=features.map(row=>row.metadata.fid);
  const encoded=await encodeHydroRepairPlan({features,changedFeatureIds,boundsPendingFor:changedFeatureIds},encoding),
    pack=await buildHydroPack({features,encoded,changedFeatureIds},{...encoding,metadataFloatFields:true}),sourceReceipt=structuredClone(source);
  sourceReceipt.naturalEarthLakes.selected=lakeFeatures.features.length;sourceReceipt.osmWaterways.matchedSystems=osmMatches;
  sourceReceipt.independentHydronymReplacements.replacedSystems=applied.size;
  const manifest=buildHydroGenerationManifest({layout:pack.layout,stats:pack.stats,sourceRows,source:sourceReceipt,namedSystems,unnamedSystems,osmMatches});
  return {pack,manifest};
}
