import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fixture} from '../helpers/gpu-recovery-source-harness.mjs';
import {auditSharedGpuPassInitialization} from '../../scripts/lib/renderer-v2-architecture.mjs';

test('renderer architecture accepts current scheduled shared GPU initialization',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  assert.deepEqual(auditSharedGpuPassInitialization(source),[]);
});

test('shared initialization architecture rejects another device, copied resources, unawaited calls and ignored failures',()=>{
  const polygon="if (await enqueue('polygon', () => polygonOverlayPass.initialize(entry.device)) !== true) throw Error('polygon');";
  const stroke="if (await strokeRenderer.initializeProgressively(entry.device, enqueue) !== true) throw Error('stroke');";
  const selection="if (entry.selection && await enqueue('selection', () => entry.selection.initialize(entry.device, { strokeRenderer, polygonPass: polygonOverlayPass })) !== true) throw Error('selection');";
  const source=`function initializeSharedGpuPasses() {
    const entry = { device: renderDevice, selection: selectionPass };
    const initialize = async () => { ${polygon} ${stroke} ${selection} };
  }`;
  assert.deepEqual(auditSharedGpuPassInitialization(source),[]);
  assert.deepEqual(auditSharedGpuPassInitialization(source.replace(/throw Error\('([^']+)'\);/g,"{ throw Error('$1'); }")),[]);
  const changed=[
    source.replace('device: renderDevice','device: anotherDevice'),
    source.replace('selection: selectionPass','selection: anotherSelection'),
    source.replace('{ strokeRenderer, polygonPass:', '{ strokeRenderer: copiedStrokeRenderer, polygonPass:'),
    source.replace('polygonPass: polygonOverlayPass','polygonPass: copiedPolygonPass'),
    source.replace('entry.selection.initialize(', 'entry.selection.initialize?.('),
    source.replace("await enqueue('selection'", "enqueue('selection'"),
    source.replace(selection,selection.replace('!== true','=== false')),
    source.replace("throw Error('selection')","return false"),
    source.replace(`${polygon} ${stroke} ${selection}`,`${selection} ${polygon} ${stroke}`),
  ];
  for(const mutation of changed){
    assert.notEqual(mutation,source,'Each negative case must change the contract.');
    assert.notDeepEqual(auditSharedGpuPassInitialization(mutation),[]);
  }
});

test('scheduled polygon, stroke and selection passes share the exact GPU device and resource owners',async t=>{
  const f=await fixture({shared:true}),calls=[],device=f.c.renderDevice;
  t.after(f.stop);
  f.c.polygonOverlayPass.initialize=value=>{calls.push('polygon');assert.strictEqual(value,device);return true;};
  f.c.strokeRenderer.initializeProgressively=async(value,enqueue)=>{
    calls.push('stroke');assert.strictEqual(value,device);return enqueue('stroke-body',()=>true);
  };
  f.c.selectionPass.initialize=(value,resources)=>{
    calls.push('selection');assert.strictEqual(value,device);
    assert.strictEqual(resources.strokeRenderer,f.c.strokeRenderer);
    assert.strictEqual(resources.polygonPass,f.c.polygonOverlayPass);return true;
  };
  f.c.initializeSharedGpuPasses();await f.flush();
  assert.deepEqual(calls,['polygon','stroke','selection']);
  assert.equal(f.c.sharedGpuPassesReady(),true);
  assert.deepEqual(f.events.filter(row=>['fallback','error'].includes(row[0])),[]);
});

// Exercise the canonical initializer through the actual scheduler. Unlike the
// earlier copied closure fixture, cancellation uses the renderer's reset/loss paths.
test('project replacement before shader compilation restarts preparation for the current project',async()=>{
  const f=await fixture({shared:true});
  f.c.initializeSharedGpuPasses();f.c.resetProjectRenderState({generation:8});await f.flush();
  assert.equal(f.events.filter(row=>row[0]==='stroke').length,1);
  assert.equal(f.c.sharedGpuPassesReady(),true);
  assert.equal(f.events.filter(row=>row[0]==='fallback').length,0);
});
for(const pass of ['polygon','stroke','selection'])test(`required ${pass} initialization false switches to Canvas with diagnostics`,async t=>{
  const f=await fixture({shared:true});
  t.after(f.stop);
  if(pass==='polygon')f.c.polygonOverlayPass.initialize=()=>false;
  else if(pass==='stroke')f.c.strokeRenderer.initializeProgressively=async()=>false;
  else f.c.selectionPass.initialize=()=>false;
  f.c.initializeSharedGpuPasses();await f.flush();
  const failures=f.events.filter(row=>row[0]==='fallback'),diagnostics=f.events.filter(row=>row[0]==='error');
  assert.equal(failures.length,1);assert.match(failures[0][1],new RegExp(pass));assert.equal(diagnostics.length,1);
});
test('required pass initialization exception is contained by the renderer boundary',async()=>{
  const original=new Error('shader link failed'),f=await fixture({shared:true});
  f.c.polygonOverlayPass.initialize=()=>{throw original;};f.c.initializeSharedGpuPasses();await f.flush();
  assert.deepEqual(f.events.filter(row=>row[0]==='fallback').map(row=>row[1]),['shader link failed']);
  assert.equal(f.events.filter(row=>row[0]==='error').length,1);
});
for(const replace of ['replaceProject','replaceContext','dispose'])test(`cancelled initialization after ${replace} cannot switch the current renderer`,async()=>{
  const f=await fixture({shared:true,holdStroke:true});f.c.initializeSharedGpuPasses();await f.flush();
  if(replace==='replaceProject')f.c.resetProjectRenderState({generation:8});
  else if(replace==='replaceContext')f.loss();else f.stop();
  f.rejectStroke(new Error('old shader failed'));
  // Retired continuation must settle without requiring a new animation frame.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.events.filter(row=>row[0]==='fallback').length,0);
  assert.equal(f.events.filter(row=>row[0]==='error').length,0);
  f.stop();
});
