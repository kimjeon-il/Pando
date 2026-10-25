import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const arg = name => { const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]; };
const selected=(arg('--operations')||'cut,polygon,river,reference').split(',');
assert.ok(selected.length&&selected.every(name=>['cut','polygon','river','reference'].includes(name)),'Unknown performance operation');
const baselineSha = '8e22982616e3c9ba43eeb84baec17cd886267cfa';
const git = (root,...args) => execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if(process.argv.includes('--sample-root')) {
  const root=resolve(arg('--sample-root')),mode=arg('--mode');
  const inputRoot=resolve(arg('--input-root'));
  const read=path=>readFileSync(resolve(inputRoot,path));
  const load=path=>import(pathToFileURL(resolve(root,path)).href);
  const {loadNodeCore}=await load('tools/load-node-core.mjs');
  globalThis.PandoLabSphericalCore=await loadNodeCore({root});
  globalThis.self=globalThis;
  vm.runInThisContext(readFileSync(resolve(root,'shared/frontend/js/vendor/d3.min.js'),'utf8'));
  if(mode==='baseline')vm.runInThisContext(readFileSync(resolve(root,'shared/frontend/js/vendor/polygon-clipping.min.js'),'utf8'));
  else await load('shared/frontend/js/modules/polygon-clipping-core.js');
  const world=JSON.parse(read('assets/data/countries-ne-5.1.1.geojson'));
  const geometry=id=>{const g=world.features.find(f=>f.id===id).geometry;return g.type==='Polygon'?[g.coordinates]:g.coordinates;};
  const polygonCases=[['union',[geometry('ARM'),geometry('TUR')]],['difference',[geometry('RUS'),[[[[25,50],[45,50],[45,65],[25,65],[25,50]]]]]]];
  await load('shared/frontend/js/modules/polygon-geometry.js');
  const cut=await load('apps/editor/frontend/js/modules/cut-worker-preparation.js');
  const cutCases=JSON.parse(read('tests/fixtures/shared-core/web-m97/cut-corpus.json')).map(row=>row.payload);
  const river=await load('apps/editor/frontend/js/modules/river-territory-partition.js');
  const riverCases=JSON.parse(read('tests/fixtures/shared-core/web-m972-river/synthetic-cases.json'));
  const reference=await load('plugins/pando-map-tools/lib/analysis/georef.mjs');
  const refCases=JSON.parse(read('tests/fixtures/shared-core/reference-calibration.json'));
  const operations={
    cut(){for(const input of cutCases){const result=cut.prepareCutInWorker(input,globalThis.PandoLabPolygonGeometry,globalThis.d3,globalThis.polygonClipping);assert.equal(typeof result.valid,'boolean');}},
    polygon(){for(const [method,operands] of polygonCases)assert.ok(Array.isArray(globalThis.polygonClipping[method](...operands)));},
    river(){for(const row of riverCases){const result=river.buildRiverTerritoryPartitions({...row.request,clipper:globalThis.polygonClipping});assert.ok(result.diagnostics);}},
    reference(){for(let n=0;n<10;n++)for(const row of refCases){const warp=reference.buildReferenceImageCalibrationWarp(row.input);if(warp.ok){assert.ok(warp.project([.5,.5]));reference.buildReferenceImageMesh(warp);}}}
  };
  const sample={};
  for(const name of selected){const run=operations[name];run();const start=performance.now();run();sample[name]=performance.now()-start;}
  if(selected.length===4){sample.maxRssKb=process.resourceUsage().maxRSS;sample.heapUsedBytes=process.memoryUsage().heapUsed;}
  console.log(JSON.stringify(sample));
} else {
  const baseline=resolve(arg('--baseline')),candidate=resolve(arg('--candidate')||'.');
  assert.equal(git(baseline,'rev-parse','HEAD'),baselineSha,'Expected fixed pre-P6 baseline');
  const sample=(root,mode)=>JSON.parse(execFileSync(process.execPath,[import.meta.filename,'--sample-root',root,'--mode',mode,'--input-root',candidate,'--operations',selected.join(',')],{encoding:'utf8',timeout:180000,maxBuffer:1024*1024}).trim());
  sample(baseline,'baseline');sample(candidate,'candidate');
  const rounds=[];
  const measure=()=>{for(let i=0;i<5;i++){const row={};for(const mode of i%2?['candidate','baseline']:['baseline','candidate'])row[mode]=sample(mode==='baseline'?baseline:candidate,mode);rounds.push(row);}};
  const median=v=>{const a=[...v].sort((a,b)=>a-b);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;};
  const summarize=()=>Object.fromEntries(Object.keys(rounds[0].baseline).map(name=>{const b=rounds.map(r=>r.baseline[name]),c=rounds.map(r=>r.candidate[name]);const status=Math.min(...c)>Math.max(...b)?'regression':median(c)>median(b)?'uncertain':'no-regression';return[name,{baselineMedian:median(b),candidateMedian:median(c),baselineRange:[Math.min(...b),Math.max(...b)],candidateRange:[Math.min(...c),Math.max(...c)],status}];}));
  measure();let metrics=summarize();
  if(Object.values(metrics).some(m=>m.status==='uncertain')){measure();metrics=summarize();}
  const report={operations:selected,schema:'pando-p6-calculation-performance-v1',baselineSha,candidateSha:git(candidate,'rev-parse','HEAD'),candidateDirtyDiffSha256:createHash('sha256').update(git(candidate,'diff','--binary','HEAD','--','assets/js','shared')).digest('hex'),node:process.version,cpu:os.cpus()[0]?.model,platform:process.platform,scope:'Node calculation adapters, same inputs and warm cache; no browser, Qt, frame or device claim',inputSha:git(candidate,'rev-parse','HEAD:assets/data/countries-ne-5.1.1.geojson'),rounds,metrics};
  const output=arg('--output');if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(metrics,null,2));
  if(Object.values(metrics).some(m=>m.status!=='no-regression'))process.exitCode=1;
}
