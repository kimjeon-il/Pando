// Analysis-only aggregation after the source-bound native calibration engine.
import {pythonRound} from './hydro-numeric.mjs';

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
