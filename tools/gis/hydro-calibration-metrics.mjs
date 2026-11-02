// Analysis-only aggregation after the source-bound native calibration engine.
import {pythonRound} from './hydro-numeric.mjs';
import {countHydroCalibrationChains} from './hydro-calibration-native.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const stages=[6.0,6.7,7.0,7.5],key=stage=>stage.toFixed(1);
function finite(value){if(typeof value!=='number'||!Number.isFinite(value))throw Error('Finite calibration measurement required');return value;}
function selectedAt(features,stage){
  if(!Array.isArray(features))throw Error('Calibration features required');
  return features.filter(feature=>{if(feature?.assignedStage===null)return false;
    return finite(feature?.assignedStage)<=stage+1e-9;});
}
const total=(values,field)=>values.reduce((sum,value)=>sum+finite(value[field]),0);
const ratio=(value,target)=>finite(target)<=0?null:pythonRound(finite(value)/target,4);

export function calibrationStageMetrics(data,kind){
  if(!['river','lake'].includes(kind))throw Error('River or lake calibration kind required');
  const river=kind==='river',targets=river?data.riverTargets:data.lakeTargets,
    baselines=river?data.riverBaselines:data.lakeBaselines,features=river?data.rivers:data.lakes,result={};
  for(const stage of stages){
    const name=key(stage),target=targets[name],baseline=baselines[name],selected=selectedAt(features,stage);
    if(river){
      const length=finite(baseline.lengthKm)+total(selected,'lengthKm'),pixels=finite(baseline.screenLength)+total(selected,'screenLength');
      result[name]={targetCount:finite(target.count),selectedCount:finite(baseline.count)+selected.length,
        targetLengthKm:pythonRound(finite(target.lengthKm),3),selectedLengthKm:pythonRound(length,3),lengthRatio:ratio(length,target.lengthKm),
        targetPixelLength:pythonRound(finite(target.screenLength),3),selectedPixelLength:pythonRound(pixels,3),pixelRatio:ratio(pixels,target.screenLength)};
    }else{
      const area=finite(baseline.screenArea)+total(selected,'screenArea'),count=finite(baseline.count)+selected.length;
      result[name]={targetCount:finite(target.count),selectedCount:count,countRatio:ratio(count,target.count),
        targetPixelArea:pythonRound(finite(target.screenArea),3),selectedPixelArea:pythonRound(area,3),pixelAreaRatio:ratio(area,target.screenArea)};
    }
  }
  return result;
}

export function calibrationResidualOverlap(features,kind){
  if(!['river','lake'].includes(kind))throw Error('River or lake calibration kind required');
  const selected=selectedAt(features,stages.at(-1)),field=kind==='river'?'lengthKm':'screenArea';
  const denominator=total(selected,field),numerator=selected.reduce((sum,feature)=>sum+finite(feature[field])*finite(feature.duplicateFraction),0);
  return denominator?numerator/denominator:0;
}

export function calibrationAcceptance(results){
  if(!results?.regions||!results.representativeChecks)throw Error('Calibration regions and representative checks required');
  const riverFinal=[],lakeFinal=[],intermediate=[],overlaps=[];
  for(const [id,metrics] of Object.entries(results.regions)){
    if(id==='korea')continue;
    for(const stage of stages){const river=metrics.rivers[key(stage)],lake=metrics.lakes[key(stage)];
      const riverLength=Math.abs(finite(river.lengthRatio)-1),riverPixels=Math.abs(finite(river.pixelRatio)-1),
        lakeCount=Math.abs(finite(lake.countRatio)-1),lakePixels=Math.abs(finite(lake.pixelAreaRatio)-1);
      if(stage===stages.at(-1)){riverFinal.push(Math.max(riverLength,riverPixels));lakeFinal.push(Math.max(lakeCount,lakePixels));}
      else intermediate.push(riverPixels,lakePixels);
    }
    overlaps.push(Math.max(finite(metrics.riverBaseOverlapRatio),finite(metrics.lakeBaseOverlapRatio)));
  }
  const max=values=>Math.max(0,...values);
  return {riverFinalWithin15Percent:max(riverFinal)<=0.15,intermediateScreenWithin25Percent:max(intermediate)<=0.25,
    lakeFinalWithin20Percent:max(lakeFinal)<=0.20,baseOverlapBelow2Percent:max(overlaps)<0.02,
    representativeFeaturesPresent:Object.values(results.representativeChecks).every(item=>item.present!==false)};
}

export async function estimateCalibrationWorld(regions,options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(regions)||regions.some(row=>typeof row?.region?.calibrate!=='boolean'||!Array.isArray(row.rivers)||!Array.isArray(row.lakes)))
    throw Error('Explicit calibration regions and features required');
  const active=regions.filter(row=>row.region.calibrate),rivers=active.flatMap(row=>row.rivers),lakes=active.flatMap(row=>row.lakes),
    selectedRivers=selectedAt(rivers,stages.at(-1)),selectedLakes=selectedAt(lakes,stages.at(-1));
  const chain=await countHydroCalibrationChains(selectedRivers.map(feature=>({id:Number(feature.sourceId),next:feature.nextDown,
    stage:feature.assignedStage,coordinateCount:feature.sourceCoordinateCount})),options);
  const riverFraction=selectedRivers.length/Math.max(rivers.length,1),lakeFraction=selectedLakes.length/Math.max(lakes.length,1),
    globalRivers=pythonRound(8500000*riverFraction,0),globalLakes=pythonRound(1427688*lakeFraction,0),
    riverAverage=total(selectedRivers,'sourceCoordinateCount')/Math.max(selectedRivers.length,1),
    lakeAverage=total(selectedLakes,'sourceCoordinateCount')/Math.max(selectedLakes.length,1),
    riverCoordinates=pythonRound(globalRivers*riverAverage,0),lakeCoordinates=pythonRound(globalLakes*lakeAverage,0),
    chainRatio=chain.chainCount/Math.max(chain.selectedReachCount,1),riverChains=pythonRound(globalRivers*chainRatio,0),
    gzipBytes=(riverCoordinates+lakeCoordinates)*8+(riverChains+globalLakes)*64;
  return {riverChaining:{...chain,objectReductionPercent:100*(1-chainRatio)},riverReachCount:globalRivers,riverChainCount:riverChains,
    riverCoordinateCount:riverCoordinates,lakeFeatureCount:globalLakes,lakeCoordinateCount:lakeCoordinates,gzipMiB:gzipBytes/1024/1024,
    riverRenderLoadRatio:chain.chainCount/(339+1325+4878),lakeRenderLoadRatio:selectedLakes.length/(84+767+1162),
    method:'Calibration-region selection and chaining ratios extrapolated to published global source counts.'};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
    if(process.argv.length!==3||process.argv[2]!=='--world-estimate-stream')throw Error('Expected --world-estimate-stream');
    const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;
      if(size>512*1024*1024)throw Error('Calibration world input exceeds byte budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
    console.log(JSON.stringify(await estimateCalibrationWorld(request.regions,{signal:controller.signal})));
  }catch(error){console.error('hydro-calibration-metrics: '+error.message);process.exitCode=1;}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
