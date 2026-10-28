// Review bounded same-run P5 comparison; do not label CI software rendering
// as real GPU/Android frame-rate acceptance or infer peak memory from GC deltas.
import assert from 'node:assert/strict';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const pinned='3485ad37c60389c977f1a211236788c6bd17125d';
const validSha=/^[a-f0-9]{64}$/;
const round=n=>Number(n.toFixed(3));

export function reviewBorderPerformance(raw) {
  assert.equal(raw?.schema,'p5-shared-border-performance');
  assert.equal(raw.baselineCommit,pinned,'frozen pre-C++ adapter commit must be pinned');
  assert.equal(raw.platform,'linux','compare performance on a matched Linux runner');
  assert.ok(/^v24\./.test(raw.node||''),'comparison must use pinned Node 24');
  assert.ok(Array.isArray(raw.results)&&raw.results.length===3);
  const byQuality=new Map(raw.results.map(r=>[r.quality,r]));
  assert.deepEqual([...byQuality.keys()].sort(),['canonical','preview','stress']);
  const qualities=[];
  for(const name of ['preview','canonical','stress']) {
    const row=byQuality.get(name),limit=name==='stress'?1.25:1.15;
    assert.equal(row.match,true,'P5_BORDER_PARITY_FAILED: '+name);
    assert.match(row.sourceHash,validSha,'source data hash missing: '+name);
    assert.ok(row.sourceSegments>0&&row.displaySegments>0,name+' empty');
    for(const key of ['legacy','compiled'])for(const metric of ['medianMs','minMs','maxMs','medianHeapDeltaMb','medianRssDeltaMb'])
      assert.ok(Number.isFinite(row[key][metric]),'invalid '+name+' '+key+'.'+metric);
    assert.ok(row.legacy.medianMs>0&&row.compiled.medianMs>0);
    const ratio=row.compiled.medianMs/row.legacy.medianMs;
    assert.ok(ratio<=limit,'P5_6_CPU_REGRESSION: '+name+' ratio='+ratio.toFixed(3));
    qualities.push({
      quality:name,input:row.input,sourceSha256:row.sourceHash,
      sourceSegments:row.sourceSegments,displaySegments:row.displaySegments,
      equalResult:true,legacyMedianMs:row.legacy.medianMs,
      compiledMedianMs:row.compiled.medianMs,compiledToLegacyRatio:round(ratio),
      cpuReductionPercent:round(100*(1-ratio)),
      heapDeltaMb:{legacy:row.legacy.medianHeapDeltaMb,compiled:row.compiled.medianHeapDeltaMb},
      rssDeltaMb:{legacy:row.legacy.medianRssDeltaMb,compiled:row.compiled.medianRssDeltaMb},
      memoryDiagnostic:row.compiled.medianHeapDeltaMb>row.legacy.medianHeapDeltaMb*1.5
        ? 'compiled transient heap delta exceeds 1.5x legacy (not retained-heap proof)' : 'observed',
      maxAllowedRegressionRatio:limit,
    });
  }
  return {
    schema:'p5-6-final-cpu-performance-review-v1',
    sourceBaselineCommit:pinned,node:raw.node,platform:raw.platform,
    status:'same-run JS/C++ CPU parity and regression gate passed',
    cases:qualities,
    limitations:[
      'Node forced-GC transient heap/RSS deltas are diagnostics, not peak memory budgets',
      'Shared C++ CTest validates algorithms/ownership; this CPU benchmark is run in Web Node/WASM',
      'Real GPU/Android FPS, first meaningful paint, map input latency and device performance are separate acceptance items'
    ],
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),at=args.indexOf('--input'),out=args.indexOf('--output');
  if(at<0||out<0||!args[at+1]||!args[out+1])throw Error('P5_USAGE: --input JSON --output JSON');
  const report=reviewBorderPerformance(JSON.parse(readFileSync(args[at+1],'utf8')));
  const dest=resolve(args[out+1]);mkdirSync(dirname(dest),{recursive:true});
  writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
  console.log('P5-6: same-run CPU parity and relative timing budgets passed');
}
