// P6-6 diagnostic only. Never ship the patched C++ binding or its generated WASM.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const mode = process.argv[2];
const destination = resolve(process.env.PANDO_P66_OUTPUT || 'test-results/w2-p6-6');
const cppFile = resolve('src/geometry/native/bindings/boundary-bindings.cpp');
const makeDir = () => mkdirSync(destination, {recursive:true});
const sha256 = input => createHash('sha256').update(input).digest('hex');
const once = (source,anchor,replacement) => {
  assert.equal(source.split(anchor).length,2,'Unverified P6-6 C++ instrumentation anchor: '+anchor);
  return source.replace(anchor,replacement);
};
const median = values => { const s=[...values].sort((a,b)=>a-b);
  return (s[(s.length-1)>>1]+s[s.length>>1])/2; };
const quantile = (values,p) => { const s=[...values].sort((a,b)=>a-b);
  const i=(s.length-1)*p;return s[Math.floor(i)]+(s[Math.ceil(i)]-s[Math.floor(i)])*(i%1); };
const stats = values => ({n:values.length,p50:median(values),p90:quantile(values,.9),
  min:Math.min(...values),max:Math.max(...values)});

if(mode==='patch') {
  const original=readFileSync(cppFile,'utf8');
  assert.ok(!original.includes('__p66TestOnlyTiming'),'Refuse to instrument the same source twice');
  let s=once(original,'#include <cmath>','#include <cmath>\n#include <chrono>');
  s=once(s,'        const auto sources=readStrokeSources(input,false);',
    '        const auto p66Start=std::chrono::steady_clock::now();\n'+
    '        const auto sources=readStrokeSources(input,false);\n'+
    '        const auto p66AfterInput=std::chrono::steady_clock::now();');
  s=once(s,'        const auto packet=assembleSharedStrokePacket(sources,maxEdgeDegrees);',
    '        const auto packet=assembleSharedStrokePacket(sources,maxEdgeDegrees);\n'+
    '        const auto p66AfterNative=std::chrono::steady_clock::now();');
  s=once(s,'        result.set("ownerIds",owners);\n        return result;',
    '        result.set("ownerIds",owners);\n'+
    '        const auto p66AfterOutput=std::chrono::steady_clock::now();\n'+
    '        auto p66=val::object();\n'+
    '        p66.set("inputBridgeMs",std::chrono::duration<double,std::milli>(p66AfterInput-p66Start).count());\n'+
    '        p66.set("nativeAssemblyMs",std::chrono::duration<double,std::milli>(p66AfterNative-p66AfterInput).count());\n'+
    '        p66.set("outputBridgeMs",std::chrono::duration<double,std::milli>(p66AfterOutput-p66AfterNative).count());\n'+
    '        result.set("__p66TestOnlyTiming",p66);\n'+
    '        return result;');
  makeDir();
  writeFileSync(destination+'/patch-provenance.json',JSON.stringify({
    source:'src/geometry/native/bindings/boundary-bindings.cpp',originalSha256:sha256(original),
    injectedSha256:sha256(s),testOnly:true,actualProductFileChanged:false,
    notice:'Source is modified transiently inside the CI checkout for diagnostic compilation only.'
  },null,2)+'\n',{flag:'wx'});
  writeFileSync(cppFile,s);
  console.log('P66_PATCHED',JSON.stringify({originalSha256:sha256(original),modifiedSha256:sha256(s)}));
} else if(mode==='measure'){
  const modulePath=resolve(process.env.PANDOEDITOR_WASM_MODULE || 'build-native/p66/wasm/pandoeditor-core.js');
  assert.ok(existsSync(modulePath),'Instrumented build missing: '+modulePath);
  const {default:createCore}=await import(pathToFileURL(modulePath));
  const wasm=readFileSync(modulePath.replace(/\.js$/,'.wasm'));
  const core=await createCore({wasmBinary:wasm});
  assert.equal(typeof core.boundaryAssembleStrokePacket,'function');
  const {buildGpuStrokeInstances}=await import('../shared/frontend/js/modules/gpu-stroke-geometry.js');
  const target=75205; // Historic Pando test's reported segment count; fixture itself is SYNTHETIC.
  const owners=242; // Same order of magnitude as the historical observation; not the historical input.
  const samples=10, warmups=2;
  const buildFixture = kind => {
    const list=[];
    for(let index=0;index<target;index++){
      const owner=index%owners,step=Math.floor(index/owners);
      const x=-171+(owner%22)*15+step*.002;
      const y=-76+Math.floor(owner/22)*13;
      const group='C'+String(owner).padStart(3,'0');
      const ids=kind==='shared'?[group,'C'+String((owner+1)%owners).padStart(3,'0')]:[group];
      list.push({start:[x,y],end:[x+.002,y],ownerIds:ids});
    }
    return list;
  };
  const rows=[];
  for(const kind of ['shared','outline']){
    const fixture=buildFixture(kind);
    for(let run=-warmups;run<samples;run++){
      const start=performance.now();
      const sources=[...fixture].sort((a,b)=>
        a.ownerIds.join('|').localeCompare(b.ownerIds.join('|')))
        .map(segment=>[segment.start,segment.end,segment.ownerIds]);
      const sourceMs=performance.now()-start;
      const callStart=performance.now();
      const packet=core.boundaryAssembleStrokePacket(sources,.499);
      const wasmCallMs=performance.now()-callStart;
      const t=packet.__p66TestOnlyTiming;
      assert.ok(t && [t.inputBridgeMs,t.nativeAssemblyMs,t.outputBridgeMs].every(Number.isFinite),
        'Rebuilt test-only C++ timings not found on packet');
      const instanceStart=performance.now();
      const gpu=buildGpuStrokeInstances(packet.startsEnds,packet.chainPhase,packet.ownerRanges);
      const instanceMs=performance.now()-instanceStart;
      assert.equal(packet.startsEnds.length,packet.segments.length*4);
      assert.equal(packet.chainPhase.length,packet.segments.length);
      assert.equal(gpu.instances.length,gpu.segmentCount*10);
      const overhead=wasmCallMs-t.inputBridgeMs-t.nativeAssemblyMs-t.outputBridgeMs;
      const record={kind,run,warmup:run<0,sourceCount:sources.length,
        assembledCount:packet.segments.length,instanceCount:gpu.segmentCount,
        nodeCount:gpu.nodeCount,sourceSortAndMapMs:sourceMs,wasmCallMs,
        inputBridgeMs:t.inputBridgeMs,nativeAssemblyMs:t.nativeAssemblyMs,
        outputBridgeMs:t.outputBridgeMs,wasmWrapperResidualMs:overhead,
        jsGpuStrokeInstancesMs:instanceMs,
        measuredStagesTotalMs:sourceMs+wasmCallMs+instanceMs};
      if(run>=0){rows.push(record);console.log('P66_SAMPLE',JSON.stringify(record));}
    }
  }
  makeDir();
  const metrics=['sourceSortAndMapMs','inputBridgeMs','nativeAssemblyMs','outputBridgeMs',
    'wasmWrapperResidualMs','wasmCallMs','jsGpuStrokeInstancesMs','measuredStagesTotalMs'];
  const groups=Object.fromEntries(['shared','outline'].map(kind=>{
    const values=rows.filter(row=>row.kind===kind);
    return [kind,{inputRows:target,runs:values.length,outputSegments:values.map(row=>row.assembledCount),
      metrics:Object.fromEntries(metrics.map(key=>[key,stats(values.map(row=>row[key]))]))}];
  }));
  const report={schema:'p66-diagnostic-wasm-stage-v1',scope:'synthetic input to exact production functions',
    actualP6HistoryInput:false,actualWindowsD3D11:false,
    sourcePinnedCppBlob:'b4288d45fda8ef71944071396c17671f73a2da79',
    sourcePinnedInstanceBlob:'5cf46f288cc6d3288387309de29aeb3fb4972cbf',
    runtime:'Node/Emscripten',node:process.version,platform:process.platform,arch:process.arch,
    compiledWasmSha256:sha256(wasm),parameters:{target,ownerGroups:owners,warmups,samples,maxEdgeDegrees:.499},
    stageDefinitions:{
      inputBridgeMs:'Emscripten val JS-array to C++ input reading',
      nativeAssemblyMs:'C++ assembleSharedStrokePacket(sources,maxEdgeDegrees) only',
      outputBridgeMs:'C++ packet to emscripten::val JS objects and Float32Arrays',
      wasmWrapperResidualMs:'Outer JS call minus the three inner C++ spans; includes Embind dispatcher/probe overhead; may be noisy',
      jsGpuStrokeInstancesMs:'Unmodified buildGpuStrokeInstances() wall time',
      sourceSortAndMapMs:'JS sort by owner and create per-segment source arrays, same shape as production',
    },groups,rows};
  writeFileSync(destination+'/measurements.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log('P66_SUMMARY',JSON.stringify({platform:report.platform,scope:report.scope,groups}));
} else {
  throw Error('Usage: node tools/w2-p6-6-packet-stage-benchmark.mjs [patch|measure]');
}
