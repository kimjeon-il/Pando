import test from 'node:test';
import assert from 'node:assert/strict';
import {coalesceCoverageAdjustments} from '../../tools/builtin-world-compiler.mjs';

const row=(validFrom,validTo,change={})=>({entityId:'state:target',kind:'explicit-replacement',relatedIds:['state:priority'],...change,validFrom,validTo});

test('coverage evidence without objectRef merges adjacent intervals',()=>{
 const input=[row('1900-01-01','1900-01-31'),row('1900-02-01','1900-02-28')];
 assert.deepEqual(coalesceCoverageAdjustments(input),[row('1900-01-01','1900-02-28')]);
 assert.equal(Object.hasOwn(input[0],'objectRef'),false);
});

test('coverage sorting and maximal coalescing do not mutate the input evidence',()=>{
 const input=[row('1900-03-01','1900-03-31'),row('1900-01-01','1900-01-31'),row('1900-02-01','1900-02-28')];
 const original=structuredClone(input);
 for(const value of input){Object.freeze(value.relatedIds);Object.freeze(value);}Object.freeze(input);
 const output=coalesceCoverageAdjustments(input);
 assert.deepEqual(output,[row('1900-01-01','1900-03-31')]);assert.deepEqual(input,original);
 assert.deepEqual(coalesceCoverageAdjustments(output),output);
});

test('different coverage entity, kind, related owners and precision evidence stay separate',()=>{
 const variants=[{}, {entityId:'state:other'}, {kind:'parent-clipping'}, {relatedIds:['state:other-priority']},
  {kind:'certified-clipping-precision-artifact',polygonIndex:0,areaM2:0.1,operation:'difference state:target / state:priority'},
  {kind:'certified-clipping-precision-artifact',polygonIndex:0,areaM2:0.2,operation:'difference state:target / state:priority'}];
 const input=variants.flatMap(change=>[row('1900-01-01','1900-01-31',change),row('1900-02-01','1900-02-28',change)]);
 const output=coalesceCoverageAdjustments(input);
 assert.equal(output.length,variants.length);
 for(const change of variants)assert.ok(output.some(value=>JSON.stringify(value)===JSON.stringify(row('1900-01-01','1900-02-28',change))));
});

test('coverage gaps and overlapping intervals are not silently filled or unioned',()=>{
 const gap=[row('1900-01-01','1900-01-10'),row('1900-01-12','1900-01-31')];
 const overlap=[row('1900-01-01','1900-01-10'),row('1900-01-09','1900-01-20')];
 assert.deepEqual(coalesceCoverageAdjustments(gap),gap);
 assert.deepEqual(coalesceCoverageAdjustments(overlap),overlap);
});

test('open coverage bounds coalesce only across the finite adjacent boundary',()=>{
 assert.deepEqual(coalesceCoverageAdjustments([row('1900-01-01',null),row(null,'1899-12-31')]),[row(null,null)]);
 const input=[row(null,null),row('1900-01-01','1900-01-31')];
 assert.deepEqual(coalesceCoverageAdjustments(input),input);
});

test('coverage coalescing preserves leap-day adjacency',()=>{
 const input=[row('2024-02-28','2024-02-28'),row('2024-02-29','2024-02-29'),row('2024-03-01','2024-03-01')];
 assert.deepEqual(coalesceCoverageAdjustments(input),[row('2024-02-28','2024-03-01')]);
});

test('coverage coalescing crosses BCE to CE without inventing year zero',()=>{
 assert.deepEqual(coalesceCoverageAdjustments([row('-0001-12-31','-0001-12-31'),row('0001-01-01','0001-01-01')]),
  [row('-0001-12-31','0001-01-01')]);
});

test('empty and single coverage records keep their original shape',()=>{
 assert.deepEqual(coalesceCoverageAdjustments([]),[]);
 assert.deepEqual(coalesceCoverageAdjustments([row(null,null)]),[row(null,null)]);
});
