import {readFileSync,writeFileSync} from 'node:fs';
const replace=(path,before,after)=>{const source=readFileSync(path,'utf8');if(!source.includes(before))throw Error('Reviewed runtime source changed: '+path);writeFileSync(path,source.replace(before,after));};
replace('src/rendering/gpu-upload-scheduler.js','completed: 0, cancelled: 0 };','completed: 0, cancelled: 0, maxQueueWaitMs: 0, maxJobWallMs: 0, cpuStepMs: 0, steps: 0 };');
{
 const path='src/rendering/gpu-upload-scheduler.js';let s=readFileSync(path,'utf8');
 const a=s.indexOf('    // Snapshot admission order'),b=s.indexOf('    const elapsed = now() - start;',a);
 if(a<0||b<a)throw Error('Upload owner changed');
 s=s.slice(0,a)+String.raw`    // Revisit progressing jobs while frame budget remains. A single large
    // mesh must not be limited to one 256 KiB chunk per animation frame.
    // Try zero-progress work only once per frame; never spin or starve peers.
    const stalled = new Set();
    let attempts = 0;
    while (jobs.size && bytes > 0 && now() - start < 2 && attempts < 1024) {
      let progressed = false;
      for (const job of [...orderedJobs]) {
        if (now() - start >= 2 || bytes <= 0 || attempts >= 1024) break;
        if (jobs.get(job.key) !== job || stalled.has(job)) continue;
        if (interaction && !job.allowDuringInteraction) continue;
        const before = now();
        if (job.startedAt === null) {
          job.startedAt = before;
          stats.maxQueueWaitMs = Math.max(stats.maxQueueWaitMs, before - job.queuedAt);
        }
        attempts++; stats.steps++;
        try {
          const result = job.step({ byteBudget: Math.min(bytes, 256 * 1024), deadline: start + 2 }) || {};
          if (jobs.get(job.key) !== job) continue;
          const used = Math.max(0, Number(result.bytes) || 0);
          bytes -= used; stats.uploadedBytes += used;
          jobs.delete(job.key); removeOrdered(job);
          if (result.done) {
            stats.completed++;
            stats.maxJobWallMs = Math.max(stats.maxJobWallMs, now() - job.queuedAt);
            job.resolve(result.value); progressed = true;
          } else {
            jobs.set(job.key, job); insertOrdered(job);
            if (used > 0) progressed = true;
            else stalled.add(job);
          }
        } catch (error) {
          if (jobs.get(job.key) !== job) continue;
          jobs.delete(job.key); removeOrdered(job); job.dispose?.(); job.reject(error);
        } finally { stats.cpuStepMs += Math.max(0, now() - before); }
      }
      if (!progressed) break;
    }
`+s.slice(b);
 s=s.replace('const job = { priority: 0, ...input };','const job = { priority: 0, ...input, queuedAt: now(), startedAt: null };');writeFileSync(path,s);
}
replace('tests/unit/rendering/gpu-resource-owners.test.mjs','c.tick(16); assert.equal(chunks, 1); c.tick(16); c.tick(16); await promise;','c.tick(16); assert.equal(chunks, 3); await promise;\n  assert.equal(c.scheduler.getStats().frames, 1);');
replace('src/rendering/gpu-worker-channels.js','// One owner for worker identity',"import {createVerifiedCoreWorker} from '../runtime/core-wasm-loader.js';\n\n// One owner for worker identity");
replace('src/rendering/gpu-worker-channels.js','const worker = new WorkerClass(url, options);','const worker = createVerifiedCoreWorker(url, options, {WorkerClass});');
replace('src/document/core-document-client.js','import {workerAssetUrl}',"import {createVerifiedCoreWorker} from '../runtime/core-wasm-loader.js';\nimport {workerAssetUrl}");
replace('src/document/core-document-client.js','createWorker = () => new Worker(workerAssetUrl(', 'createWorker = () => createVerifiedCoreWorker(workerAssetUrl(');
replace('src/app/viewer.js','// Preflight owns no map/document.',"import {installRuntimePerformanceMetrics} from '../runtime/runtime-performance-metrics.js';\ninstallRuntimePerformanceMetrics();\n\n// Preflight owns no map/document.");
replace('src/rendering/gpu-resource-lifecycle.js','    defer() { scheduler.defer(); },',"    defer() { scheduler.defer(); },\n    getStats() { return typeof scheduler.getStats==='function' ? {...scheduler.getStats(),scopePending:jobs.size}:null; },");
replace('src/rendering/gpu-map-renderer.js','    let firstCountryPublishedMs = null;', '    let firstCountryPublishedMs = null;\n    let firstCountryPresentedNavigationMs = null;\n    let firstMeshUploadTiming = null;');
replace('src/rendering/gpu-map-renderer.js','          firstCountryPublishedMs ??= Math.max(0, performance.now() - rendererStartedAt);',String.raw`          firstCountryPublishedMs ??= Math.max(0, performance.now() - rendererStartedAt);
          if(firstCountryPresentedNavigationMs===null){
            firstCountryPresentedNavigationMs=performance.now();
            globalThis.__PANDOLAB_PERFORMANCE__?.mark('map.first-country-frame',{
              generation:projectGeneration,renderer:rendererMode,fromNavigationMs:firstCountryPresentedNavigationMs});
          }`);
replace('src/rendering/gpu-map-renderer.js','      const scheduler = uploadScheduler, key = `mesh:${++stagingSequence}`;', '      const scheduler = uploadScheduler, key = `mesh:${++stagingSequence}`;\n'+String.raw`      const timing=firstMeshUploadTiming===null ? firstMeshUploadTiming={
        generation,queuedAtMs:performance.now(),submittedAtMs:null,gpuCompletedAtMs:null,
        status:'queued',cpuCallsMs:0,bytes:0} : null;`);
replace('src/rendering/gpu-map-renderer.js','          const oldArray = gl.getParameter(gl.ARRAY_BUFFER_BINDING);\n          const oldElement','          const stepStarted=performance.now();\n          const oldArray = gl.getParameter(gl.ARRAY_BUFFER_BINDING);\n          const oldElement');
replace('src/rendering/gpu-map-renderer.js','              gl.bufferSubData(task.target, task.offset, chunk);\n              if (onProgress)','              gl.bufferSubData(task.target, task.offset, chunk);\n              if(timing)timing.bytes+=bytes;\n              if (onProgress)');
replace('src/rendering/gpu-map-renderer.js','          } finally { gl.bindBuffer(gl.ARRAY_BUFFER, oldArray); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, oldElement); }','          } finally { gl.bindBuffer(gl.ARRAY_BUFFER, oldArray); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, oldElement); if(timing)timing.cpuCallsMs+=performance.now()-stepStarted; }');
replace('src/rendering/gpu-map-renderer.js',"      try { return await pending; }\n      finally { signal?.removeEventListener('abort', abort); }",String.raw`      try {
        const result=await pending;
        if(timing){
          timing.submittedAtMs=performance.now();timing.status='submitted';
          globalThis.__PANDOLAB_PERFORMANCE__?.record('gpu.country-upload-submit',timing.submittedAtMs-timing.queuedAtMs,{...timing});
          // Diagnostic fence is never another readiness gate or a gl.finish.
          // Command completion is not physical monitor scanout.
          try{if(glVersion===2&&typeof uploadGl.fenceSync==='function'){
            const sync=lifecycle.retain(uploadGl,'Sync',uploadGl.fenceSync(uploadGl.SYNC_GPU_COMMANDS_COMPLETE,0));
            if(sync){
              uploadGl.flush();
              const poll=()=>{
                try{
                  if(disposed||gl!==uploadGl||generation!==projectGeneration||uploadGl.isContextLost()){
                    timing.status='superseded';lifecycle.release(sync);return;
                  }
                  const state=uploadGl.clientWaitSync(sync,0,0);
                  if(state===uploadGl.ALREADY_SIGNALED||state===uploadGl.CONDITION_SATISFIED){
                    timing.gpuCompletedAtMs=performance.now();timing.status='gpu-complete';lifecycle.release(sync);
                    globalThis.__PANDOLAB_PERFORMANCE__?.record('gpu.country-upload-complete',timing.gpuCompletedAtMs-timing.queuedAtMs,{...timing});
                  }else if(state===uploadGl.WAIT_FAILED||performance.now()-timing.submittedAtMs>10000){
                    timing.status='unavailable';lifecycle.release(sync);
                  }else lifecycle.frame(poll);
                }catch(error){timing.status='unavailable';timing.error=String(error.message);lifecycle.release(sync);}
              };
              lifecycle.frame(poll);
            }else timing.status='unavailable';
          }else timing.status='unsupported';
          }catch(error){timing.status='unavailable';timing.error=String(error.message);}
        }
        return result;
      }catch(error){if(timing)timing.status=error.name==='AbortError'?'cancelled':'failed';throw error;}
      finally { signal?.removeEventListener('abort', abort); }`);
replace('src/rendering/gpu-map-renderer.js','        lastMeshPreparation: performanceMetrics.lastMeshPreparation || null,','        lastMeshPreparation: performanceMetrics.lastMeshPreparation || null,\n        gpuUpload: uploadScheduler?.getStats?.() || null,\n        firstMeshUploadTiming:firstMeshUploadTiming?{...firstMeshUploadTiming}:null,\n        firstCountryPresentedNavigationMs,');
// Strengthen the existing real startup regression with observable network and
// upload receipts. Do not replace renderer identity/presentation assertions.
replace('tests/browser/runtime/viewer-readonly-startup.spec.mjs','const errors=[],samples=[];','const errors=[],samples=[],requests=[];\n  page.on(\'request\',request=>requests.push(request.url()));');
replace('tests/browser/runtime/viewer-readonly-startup.spec.mjs','const start=Date.now();','const start=Date.now(),requestStart=requests.length;');
replace('tests/browser/runtime/viewer-readonly-startup.spec.mjs','firstCountryPublishedMs:stats.firstCountryPublishedMs,','firstCountryPublishedMs:stats.firstCountryPublishedMs,\n        firstCountryPresentedNavigationMs:stats.firstCountryPresentedNavigationMs,\n        gpuUpload:stats.gpuUpload,firstMeshUploadTiming:stats.firstMeshUploadTiming,');
replace('tests/browser/runtime/viewer-readonly-startup.spec.mjs','samples.push({visit,elapsedMs:Date.now()-start,...row});',String.raw`    const network=requests.slice(requestStart).map(url=>new URL(url).pathname);
    samples.push({visit,elapsedMs:Date.now()-start,...row,
      wasmRequests:network.filter(path=>path.endsWith('/pandoeditor-core.wasm')).length,
      countryDescriptorRequests:network.filter(path=>/builtin-world\/generated\/v1\/(countries|country-parts)\//.test(path)).length});`);
replace('tests/browser/runtime/viewer-readonly-startup.spec.mjs','expect(row.entities).toBeGreaterThan(0);',String.raw`expect(row.entities).toBeGreaterThan(0);
    expect(row.wasmRequests,'workers reuse the verified compiled Core').toBeLessThanOrEqual(1);
    expect(row.countryDescriptorRequests,'runtime never reconstructs authoring documents').toBe(0);
    expect(row.metrics?.operations?.['core.worker-ready']?.count).toBeGreaterThan(0);
    expect(row.firstMeshUploadTiming?.submittedAtMs).toBeGreaterThan(row.firstMeshUploadTiming?.queuedAtMs);
    expect(row.firstCountryPresentedNavigationMs).toBeGreaterThan(0);`);
