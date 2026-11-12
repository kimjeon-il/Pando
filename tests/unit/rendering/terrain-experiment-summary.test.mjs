import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeComparison} from '../../../scripts/terrain-experiment/summarize-viewer-comparison.mjs';

test('comparison summary keeps failures visible and only aggregates three valid repetitions',()=>{
  const row=(candidate,value,status='passed')=>({candidate,status,readyMs:value,frames:{count:300,p50Ms:value,p95Ms:value+1,p99Ms:value+2},
    phases:[{name:'drag',status,readyMs:value,frames:{count:300,p50Ms:value,p95Ms:value+1,p99Ms:value+2}}]});
  const report={schema:'pando-terrain-viewer-regional-ab-v1',region:'x',runs:[row('a1',3),row('a1',1),row('a1',2),row('cog',9),row('cog',10,'failed')]};
  const result=summarizeComparison(report),a=result.groups.find(x=>x.candidate==='a1'&&x.scene==='zoom32');
  assert.equal(a.passed,3);assert.equal(a.metrics.readyMs.median,2);assert.equal(a.metrics.p95Ms.median,3);
  const c=result.groups.find(x=>x.candidate==='cog'&&x.scene==='zoom32');
  assert.equal(c.passed,1);assert.equal(c.failed,1);assert.equal(c.metrics.readyMs.median,null);
  assert.equal(c.score,null);assert.equal(c.hardGate,'not-assessed');
  assert.equal(result.groups.find(x=>x.candidate==='a1'&&x.scene==='drag').metrics.p99Ms.median,4);
});
