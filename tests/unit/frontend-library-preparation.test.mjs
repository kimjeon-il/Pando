import test from 'node:test';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,unlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discardDeadLibraryLock,withLibraryLock} from "../../tools/data/library-context.mjs";
import {prepareLibraryWhenAvailable} from '../../scripts/lib/library-preparation-wait.mjs';

function activeOwner(t){
 const root=mkdtempSync(join(tmpdir(),'pando-library-wait-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const lock=join(root,'.library-data/prepare.lock'),bytes=JSON.stringify({pid:process.pid,root});
 mkdirSync(join(root,'.library-data'));writeFileSync(lock,bytes);
 return{root,lock,bytes};
}

test('frontend preparation waits for a live owner and then uses the canonical lock',async t=>{
 const {root,lock,bytes}=activeOwner(t),prepared={revision:'prepared-pin',files:{}};
 let attempts=0,operations=0;
 const release=setTimeout(()=>unlinkSync(lock),30);t.after(()=>clearTimeout(release));
 const actual=await prepareLibraryWhenAvailable(()=>{
  attempts++;
  if(existsSync(lock))assert.equal(readFileSync(lock,'utf8'),bytes,'the active owner is preserved');
  return withLibraryLock(root,()=>{operations++;return prepared;});
 },{timeoutMs:1000,retryMs:5});
 assert.strictEqual(actual,prepared);assert.equal(operations,1);assert.ok(attempts>1);
 assert.equal(existsSync(lock),false,'canonical preparation releases its own lock');
});

test('frontend preparation immediately reuses a successful canonical result',async()=>{
 const prepared={revision:'unchanged-pin',files:{}};
 let attempts=0;
 assert.strictEqual(await prepareLibraryWhenAvailable(()=>{attempts++;return prepared;}),prepared);
 assert.equal(attempts,1);
});

test('frontend preparation timeout preserves the other live owner',async t=>{
 const {root,lock,bytes}=activeOwner(t);
 await assert.rejects(prepareLibraryWhenAvailable(()=>withLibraryLock(root,()=>assert.fail('busy owner was bypassed')),{timeoutMs:20,retryMs:5}),
  error=>error.code==='PL-LIBRARY-PREPARE-TIMEOUT'&&error.cause.cause.code==='EEXIST');
 assert.equal(readFileSync(lock,'utf8'),bytes);
});

test('frontend preparation immediately propagates non-lock failures',async()=>{
 for(const failure of [new Error('Invalid pinned manifest'),Object.assign(new Error('Other existing file'),{cause:{code:'EEXIST'}})]){
  let attempts=0;
  await assert.rejects(prepareLibraryWhenAvailable(()=>{attempts++;throw failure;}),error=>error===failure);
  assert.equal(attempts,1);
 }
});

test('a lock released between existence and stat can be acquired without touching another owner',t=>{
 const {root,lock}=activeOwner(t);
 const original=fs.lstatSync;let simulatedRelease=false;
 fs.lstatSync=function(path,...args){
  if(path===lock&&!simulatedRelease){simulatedRelease=true;unlinkSync(lock);}
  return original.call(this,path,...args);
 };
 syncBuiltinESMExports();
 try{
  assert.equal(withLibraryLock(root,()=> 'prepared'),'prepared');
  assert.equal(simulatedRelease,true);
  assert.equal(existsSync(lock),false);
 }finally{fs.lstatSync=original;syncBuiltinESMExports();}
});

test('lock inspection tolerates release during reinspection and preserves other errors',t=>{
 const {root,lock}=activeOwner(t);
 const originalStat=fs.lstatSync,originalKill=process.kill;let inspections=0;
 process.kill=()=>{throw Object.assign(new Error('gone'),{code:'ESRCH'});};
 fs.lstatSync=function(path,...args){
  if(path===lock&&++inspections===2)unlinkSync(lock);
  return originalStat.call(this,path,...args);
 };
 syncBuiltinESMExports();
 try{
  assert.equal(discardDeadLibraryLock(lock),false);
  assert.equal(withLibraryLock(root,()=> 'prepared'),'prepared');
  fs.lstatSync=()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});};
  syncBuiltinESMExports();
  assert.throws(()=>discardDeadLibraryLock(lock),{code:'EACCES'});
 }finally{fs.lstatSync=originalStat;process.kill=originalKill;syncBuiltinESMExports();}
});
