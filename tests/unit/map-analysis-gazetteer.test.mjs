import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGazetteerFiles,createGazetteer} from '../../plugins/pando-map-tools/lib/analysis/gazetteer.mjs';

const rows=[{id:'geonames:1',name:'Whitehorse',aliases:['White Horse','ホワイトホース'],coordinates:[-135,60],countryCode:'CA',population:28000},
  {id:'geonames:2',name:'Sydney',aliases:['سدني'],coordinates:[151,-33],countryCode:'AU',population:5000000},
  {id:'geonames:3',name:'Sydney',aliases:[],coordinates:[-60,46],countryCode:'CA',population:30000},
  {id:'geonames:4',name:'Αθήνα',aliases:['Athens'],coordinates:[23,38],countryCode:'GR',population:600000}];
function fixture(){const files=buildGazetteerFiles(rows,{sha256:'a'.repeat(64),license:'CC BY 4.0'});const fetched=[];
  const store=createGazetteer({manifest:files.manifest,fetchBytes:async spec=>{fetched.push(spec.path);return files.files.get(spec.path);}});return {files,store,fetched};}
test('global search finds original aliases, Greek normalization and OCR typos without a viewport',async()=>{
  const {store}=fixture();
  for(const name of ['Whitehorse','Whltehorse','ホワイトホース'])assert.equal((await store.search(name)).records[0].id,'geonames:1');
  assert.equal((await store.search('Αθηνα')).records[0].id,'geonames:4');
});
test('same-name places remain distinct and cached shards are reused',async()=>{
  const {store,fetched}=fixture();assert.equal((await store.search('Sydney')).records.length,2);
  const count=fetched.length;await store.search('Sydney');assert.equal(fetched.length,count);
});
test('tampered resources and aborted searches cannot return successful candidates',async()=>{
  const {files}=fixture();const store=createGazetteer({manifest:files.manifest,fetchBytes:async()=>Buffer.from('{}')});
  await assert.rejects(store.search('Whitehorse'),/hash|size/i);
  const controller=new AbortController();controller.abort();await assert.rejects(fixture().store.search('Whitehorse',{signal:controller.signal}));
});
test('source identities, coordinates and alias input are validated at build time',()=>{
  assert.throws(()=>buildGazetteerFiles([...rows,rows[0]],{sha256:'a'.repeat(64),license:'CC0'}),/duplicate/i);
  assert.throws(()=>buildGazetteerFiles([{...rows[0],coordinates:[0,100]}],{sha256:'a'.repeat(64),license:'CC0'}),/coordinate/i);
});
