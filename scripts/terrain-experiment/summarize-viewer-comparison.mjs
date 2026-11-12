import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const median=values=>{
  if(values.length<3)return null;
  const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
};
export function summarizeComparison(report){
  if(report?.schema!=='pando-terrain-viewer-regional-ab-v1'||!Array.isArray(report.runs))throw Error('Invalid Viewer experiment report');
  const grouped=new Map();
  for(const run of report.runs){
    const scenes=[{...run,name:'zoom32'},...(Array.isArray(run.phases)?run.phases:[])];
    for(const scene of scenes){
      const key=JSON.stringify([run.candidate,scene.name]);
      if(!grouped.has(key))grouped.set(key,{candidate:run.candidate,scene:scene.name,rows:[]});
      grouped.get(key).rows.push({run,scene});
    }
  }
  const fields={readyMs:row=>row.scene.readyMs,p50Ms:row=>row.scene.frames?.p50Ms,p95Ms:row=>row.scene.frames?.p95Ms,
    p99Ms:row=>row.scene.frames?.p99Ms,pssBytes:row=>row.scene.chromiumProcessMemory?.pssBytes,
    jsHeapUsedBytes:row=>row.scene.performance?.jsHeapUsedBytes,cpuTaskMs:row=>row.scene.performance?.cpuMs?.TaskDuration,
    terrainCacheBytes:row=>row.scene.renderer?.terrainCacheBytes,gpuTrackedBuffersBytes:row=>row.scene.renderer?.gpuTrackedBuffersBytes};
  const groups=[...grouped.values()].map(group=>{
    const valid=group.rows.filter(({run,scene})=>run.status==='passed'&&scene.status==='passed'&&scene.frames?.count>=300);
    const metrics=Object.fromEntries(Object.entries(fields).map(([name,get])=>{
      const values=valid.map(get).filter(Number.isFinite);
      return [name,{values,median:median(values)}];
    }));
    const failed=group.rows.filter(({run,scene})=>run.status==='failed'||scene.status==='failed').length;
    const detailLevels=valid.map(({scene})=>scene.renderer?.terrainRenderedLevel??null);
    const screenVerified=group.candidate!=='screen'||valid.every(({scene})=>
      scene.screenSpaceCoverage!=='not-verified'&&scene.screenSpaceCoverage!=='not-applicable'&&scene.frameCapture?.screenDraws>0);
    return {candidate:group.candidate,scene:group.scene,total:group.rows.length,passed:valid.length,
      detailLevels,screenVerified,
      failed,invalidOrIncomplete:group.rows.length-valid.length-failed,metrics,hardGate:'not-assessed',score:null};
  });
  for(const group of groups){
    const baseline=groups.find(item=>item.candidate==='a1'&&item.scene===group.scene);
    const levels=[...(baseline?.detailLevels||[]),...group.detailLevels];
    group.lodCompatibleWithA1=group.candidate==='a0'?null:
      !!baseline&&baseline.passed>=3&&group.passed>=3&&group.screenVerified&&
      levels.every(Number.isFinite)&&new Set(levels).size===1;
  }
  return {schema:'pando-terrain-viewer-summary-v1',region:report.region,projection:report.projection??'unknown',identity:report.identity,sourceStatus:report.status,
    fixtureRevision:report.fixtureRevision??null,fixtureManifestSha256:report.fixtureManifestSha256??null,
    cogSource:report.cogSource??null,tilePrefetch:report.tilePrefetch??null,comparisonPolicy:report.comparisonPolicy??null,
    normalizedBudget:report.normalizedBudget??null,
    minimumValidRepetitions:3,limitations:[...(report.limitations||[]),'Medians summarize per-run statistics; they are not pooled frame percentiles or confidence intervals.',
      'LOD compatibility checks only the recorded detail level and verified D drawing; it does not prove matching color or overall quality.',
      'Hard gates and scores require independent visual, failure, hardware, and operational evidence.'],groups};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Expected input report and new output file');
  const report=JSON.parse(await readFile(input,'utf8')),summary=summarizeComparison(report);
  await writeFile(output,JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({groups:summary.groups.length,sourceStatus:summary.sourceStatus}));
}
