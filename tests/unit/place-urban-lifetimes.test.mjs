import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {validatePlaceUrbanLifetimes,indexPlaceUrbanLifetimes,placeUrbanLabelActiveAtMonth}
  from '../../shared/frontend/js/modules/place-lifetime-policy.js';

const library=new URL('../../assets/data/places/urban-lifetimes-v1.json',import.meta.url);
const catalog=validatePlaceUrbanLifetimes(JSON.parse(readFileSync(library,'utf8')));
const index=indexPlaceUrbanLifetimes(catalog);
const geo=id=>({source:'geonames',sourceId:String(id)});

test('reviewed city-label lifetimes are externally sourced, immutable evidence with original precision',()=>{
  assert.equal(existsSync(new URL('../../config/builtin-display-policy.json',import.meta.url)),false);
  assert.ok(existsSync(new URL('../../assets/data/builtin-world/display-policy-v1.json',import.meta.url)));
  assert.equal(catalog.entries.length,58);
  assert.equal(catalog.entries.filter(row=>row.intervals.length).length,55);
  assert.equal(index.get('geonames:993800').intervals[0].fromYear,1886);
  assert.equal(index.get('geonames:3046446').intervals[0].untilDateExclusive,'1873-11-17');
  assert.equal(index.get('geonames:2352778').status,'provisional');
  assert.deepEqual(index.get('geonames:2161314').intervals,[]);
});
test('historical urban identity follows verified start and merger cutoffs without editing raw names',()=>{
  assert.equal(placeUrbanLabelActiveAtMonth(geo(3054643),'1873-10',index),false);
  assert.equal(placeUrbanLabelActiveAtMonth(geo(3054643),'1873-11',index),true);
  assert.equal(placeUrbanLabelActiveAtMonth(geo(3046446),'1873-10',index),true);
  assert.equal(placeUrbanLabelActiveAtMonth(geo(3046446),'1873-11',index),false);
  assert.equal(placeUrbanLabelActiveAtMonth(geo(993800),'1885-12',index),false);
  assert.equal(placeUrbanLabelActiveAtMonth(geo(993800),'1886-01',index),true);
  assert.equal(placeUrbanLabelActiveAtMonth(geo(2161314),'1820-01',index),true,
    'unverified multi-episode history does not invent a disappearance');
  assert.equal(placeUrbanLabelActiveAtMonth(geo(999999999),'1820-01',index),true);
});
test('malformed and overlapping external lifetime intervals are rejected',()=>{
  const clone=structuredClone(catalog);
  clone.entries[0].intervals=[{fromDate:'2026-02-30'}];
  assert.throws(()=>validatePlaceUrbanLifetimes(clone),/interval/i);
  const duplicate=structuredClone(catalog);
  duplicate.entries.push(structuredClone(duplicate.entries[0]));
  assert.throws(()=>validatePlaceUrbanLifetimes(duplicate),/duplicate/i);
});
