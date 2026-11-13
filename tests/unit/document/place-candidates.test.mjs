import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "node:fs";
import * as __dep10 from "../../../src/data/place-lifetime-policy.js";

contractSuite("place-urban-lifetimes", () => {
const test=__dep1.default;
const assert=__dep0.default;
const { readFileSync }=__dep2;
const { validatePlaceUrbanLifetimes, indexPlaceUrbanLifetimes, placeUrbanLabelActiveAtMonth }=__dep10;

const library=new URL("../../fixtures/places/urban-lifetimes-mini.json",import.meta.url);
const catalog=validatePlaceUrbanLifetimes(JSON.parse(readFileSync(library,'utf8')));
const index=indexPlaceUrbanLifetimes(catalog);
const geo=id=>({source:'geonames',sourceId:String(id)});

test('selected city-label lifetime fixtures retain original date precision',()=>{
  assert.equal(catalog.entries.length,5);
  assert.equal(catalog.entries.filter(row=>row.intervals.length).length,4);
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
  assert.equal(placeUrbanLabelActiveAtMonth(geo(2352778),'1801-01',index),true,
    'provisional Dakar founding rule cannot prove absence of the older settlement');
  assert.equal(placeUrbanLabelActiveAtMonth(geo(999999999),'1820-01',index),true);
});
test('malformed and overlapping external lifetime intervals are rejected',()=>{
  const clone=structuredClone(catalog);
  clone.entries[0].intervals=[{fromDate:'2026-02-30'}];
  assert.throws(()=>validatePlaceUrbanLifetimes(clone),/interval/i);
  const duplicate=structuredClone(catalog);
  duplicate.entries.push(structuredClone(duplicate.entries[0]));
  assert.throws(()=>validatePlaceUrbanLifetimes(duplicate),/duplicate/i);
  const overlap=structuredClone(catalog);
  overlap.entries[0].intervals=[{fromYear:1900},{fromYear:2000}];
  assert.throws(()=>validatePlaceUrbanLifetimes(overlap),/overlap/i);
});
});
