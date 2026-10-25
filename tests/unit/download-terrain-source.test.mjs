import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { downloadVerifiedRanges } from '../../tools/download-terrain-source.mjs';

async function server(t,{bad=false}={}) {
 const contents=Buffer.from('verified-HTTP-ranges-0123456789-'.repeat(100000));
 const calls=[];
 const app=createServer((req,res)=>{
  calls.push({method:req.method,range:req.headers.range});
  res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',contents.length);
  res.setHeader('ETag','"v1"');
  if(req.method==='HEAD') {res.end();return;}
  const m=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range||'');
  if(!m||bad){res.writeHead(200);res.end(contents);return;}
  const start=Number(m[1]),end=Number(m[2]);
  if(start<0||end>=contents.length||end<start){res.writeHead(416);res.end();return;}
  res.statusCode=206;res.setHeader('Content-Range','bytes '+start+'-'+end+'/'+contents.length);
  res.setHeader('Content-Length',end-start+1);
  res.end(contents.subarray(start,end+1));
 });
 app.listen(0,'127.0.0.1');await once(app,'listening');
 t.after(()=>new Promise((resolve,reject)=>app.close(error=>error?reject(error):resolve())));
 return {url:'http://127.0.0.1:'+app.address().port+'/large.zip',contents,calls};
}
test('range client resumes an existing verified prefix without changing original on failure',async t=>{
 const s=await server(t);
 const folder=mkdtempSync(join(tmpdir(),'range-test-'));
 t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const output=join(folder,'large.zip');
 const prefix=s.contents.subarray(0,1000);
 writeFileSync(output,prefix);
 const done=await downloadVerifiedRanges({url:s.url,output,workers:3,chunkMiB:1,quiet:true});
 assert.equal(done.status,'completed');assert.equal(done.prefix,prefix.length);
 assert.deepEqual(readFileSync(output),s.contents);
 assert.ok(s.calls.some(x=>x.range?.startsWith('bytes=1000-')));
 assert.deepEqual(readdirSync(folder),['large.zip']);
 assert.equal((await downloadVerifiedRanges({url:s.url,output,quiet:true})).status,'already-complete');
});
test('server ignoring ranges cannot promote partial data to a complete output',async t=>{
 const s=await server(t,{bad:true});
 const folder=mkdtempSync(join(tmpdir(),'range-reject-'));
 t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const output=join(folder,'file.zip'),old=Buffer.from('original-verified-prefix');
 writeFileSync(output,old);
 await assert.rejects(downloadVerifiedRanges({url:s.url,output,workers:2,chunkMiB:1,quiet:true}),/Bad range response/);
 assert.deepEqual(readFileSync(output),old);
 assert.deepEqual(readdirSync(folder),['file.zip']);
});
