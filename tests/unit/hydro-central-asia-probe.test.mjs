/* global AbortController */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {probeCentralAsiaGauges,readCentralAsiaGauges} from '../../tools/gis/probe-central-asia-gauges.mjs';

test('scientific station and river fields remain distinct with exact source bounding boxes',t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-gauge-test-'));t.after(()=>rmSync(root,{recursive:true}));const path=join(root,'fixture.gpkg');
  const db=new DatabaseSync(path);db.exec("CREATE TABLE gpkg_contents(table_name,data_type); INSERT INTO gpkg_contents VALUES('Gauges','features'); CREATE TABLE Gauges(lon,lat,code,river,basin,name_eng)");
  const insert=db.prepare('INSERT INTO Gauges VALUES(?,?,?,?,?,?)');
  insert.run(65.25,37.83,'A','Amu','Aral','Kerki');insert.run(70,44,'B','Ili','Balkhash','Named station');
  insert.run(1,1,'C','Outside','Elsewhere','Other');insert.run(null,36,'D','Missing coordinate','Aral',null);insert.run(' ',36,'E','Invalid coordinate','Aral',null);db.close();
  const actual=readCentralAsiaGauges(path);assert.equal(actual.sourceGaugeCount,5);assert.equal(actual.gauges.length,2);
  assert.deepEqual(actual.gauges[0],{candidateSystem:'20628098',longitude:65.25,latitude:37.83,code:'A',river:'Amu',basin:'Aral',station:'Kerki'});
  assert.equal(actual.gauges[1].candidateSystem,'40188382');assert.equal(actual.gauges[1].station,'Named station');
});
test('source checksum or network failures cannot admit gauge data',async()=>{
  for(const fetcher of [async()=>new Response('unverified sqlite bytes'),async()=>{throw Error('offline');}]){
    const result=await probeCentralAsiaGauges({fetcher});assert.equal(result.downloadStatus,'not-available');assert.deepEqual(result.gauges,[]);assert.equal(result.downloadErrors.length,2);
    assert.equal(result.sourceSha256,undefined);
  }
});
test('cancelled scientific-source requests remain cancelled',async()=>{
  const controller=new AbortController();controller.abort(Error('cancelled by caller'));
  await assert.rejects(probeCentralAsiaGauges({signal:controller.signal,fetcher:async()=>{assert.fail('must not fetch');}}),/cancelled by caller/);
});
