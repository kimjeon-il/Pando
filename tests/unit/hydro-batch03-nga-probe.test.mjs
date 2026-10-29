import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {probeNgaBatch03} from '../../tools/gis/probe-nga-streams.mjs';

test('last-eleven NGA queries retain bounded source receipts and merge aliases by UFI and location',async()=>{
  const raw=JSON.stringify({exceededTransferLimit:true,features:[
    {attributes:{desig_cd:'STM',ufi:123,long_dd:107,lat_dd:11,full_name:'Đồng Nai',cc_ft:'VM'}},
    {attributes:{desig_cd:'STM',ufi:123,long_dd:107,lat_dd:11,full_name:'Dong Nai',cc_ft:'VM'}},
    {attributes:{desig_cd:'PPL',ufi:456,long_dd:107,lat_dd:11,full_name:'not river'}},
  ]});
  let active=0,maximum=0;
  const fetcher=async url=>{
    const where=new URL(url).searchParams.get('where');active++;maximum=Math.max(maximum,active);
    await new Promise(ok=>setTimeout(ok,2));active--;
    if(where.includes('Kum-gang'))return new Response('unavailable',{status:503});
    return new Response(raw,{status:200,headers:{'content-type':'application/json'}});
  };
  const receipts=await probeNgaBatch03({fetcher});assert.equal(receipts.length,13);assert.ok(maximum<=5);
  const failure=receipts.find(item=>item.systemId==='40475481');assert.equal(failure.status,'not-confirmed');
  assert.match(failure.note,/not evidence/);
  const row=receipts.find(item=>item.systemId==='41386179'&&item.kind==='all-streams-in-small-bbox');
  assert.equal(row.status,'queried');assert.equal(row.rawFeatureCount,3);assert.equal(row.uniqueRiverPointCount,1);
  assert.equal(row.exceededTransferLimit,true);assert.equal(row.responseSha256,createHash('sha256').update(raw).digest('hex'));
  assert.deepEqual(row.features[0].names,['Đồng Nai','Dong Nai']);assert.equal(row.features[0].id,'nga_123');
});
test('last-eleven NGA probing honors cancellation',async()=>{
  const controller=new globalThis.AbortController();controller.abort();
  await assert.rejects(probeNgaBatch03({signal:controller.signal}),/abort/i);
});
