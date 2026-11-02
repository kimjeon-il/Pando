import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {libraryWriteGitEnvironment} from '../../tools/library-data.mjs';
const dummy='test-only-not-a-secret';
test('write auth override is command scoped and absent token preserves checkout auth',()=>{
 const base={SENTINEL:'same'};assert.equal(libraryWriteGitEnvironment('',base),base);
 const env=libraryWriteGitEnvironment(dummy,base);assert.deepEqual(base,{SENTINEL:'same'});
 assert.equal(env.GIT_CONFIG_COUNT,'2');assert.equal(env.GIT_CONFIG_VALUE_0,'');
 assert.equal(env.GIT_CONFIG_KEY_0,env.GIT_CONFIG_KEY_1);assert.equal(env.SENTINEL,'same');
});
test('actual git HTTP read and push send one header despite persisted checkout auth',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pando-auth-contract-'));
 const received=[];
 const server=createServer((req,res)=>{received.push(req.rawHeaders.filter((_,i,a)=>i%2===0&&a[i].toLowerCase()==='authorization').length);res.writeHead(401);res.end();});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}/`;
 try {
  execFileSync('git',['init','-q',dir]);
  execFileSync('git',['-C',dir,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-qm','fixture']);
  execFileSync('git',['-C',dir,'config',`http.${url}.extraheader`,'AUTHORIZATION: basic dummy-checkout']);
  const base={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/bin/false',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
  const fixed=libraryWriteGitEnvironment(dummy,base);
  // Substitute only the destination scope for an isolated loopback receiver.
  fixed.GIT_CONFIG_KEY_0=fixed.GIT_CONFIG_KEY_1=`http.${url}.extraheader`;
  const broken={...base,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:`http.${url}.extraheader`,GIT_CONFIG_VALUE_0:fixed.GIT_CONFIG_VALUE_1};
  const run=env=>new Promise((resolve,reject)=>{const p=spawn('git',['-c','credential.helper=','ls-remote',url],{cwd:dir,env,stdio:'ignore'});p.on('error',reject);p.on('exit',resolve);});
  await run(libraryWriteGitEnvironment('',base));assert.ok(received.length);assert.ok(received.every(n=>n===1));received.length=0;
  await run(broken);assert.ok(received.length);assert.ok(received.every(n=>n===2));received.length=0;
  await run(fixed);assert.ok(received.length);assert.ok(received.every(n=>n===1));received.length=0;
  await new Promise((resolve,reject)=>{const p=spawn('git',['-c','credential.helper=','push',url,'HEAD:refs/heads/work/gis'],{cwd:dir,env:fixed,stdio:'ignore'});p.on('error',reject);p.on('exit',resolve);});
  assert.ok(received.length);assert.ok(received.every(n=>n===1));
  assert.equal(execFileSync('git',['-C',dir,'config','--get-all',`http.${url}.extraheader`],{encoding:'utf8'}).trim(),'AUTHORIZATION: basic dummy-checkout');
 } finally {await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('existing command configuration is retained before auth reset and malformed count fails closed',()=>{
 const base={GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.autocrlf',GIT_CONFIG_VALUE_0:'false'};
 const env=libraryWriteGitEnvironment(dummy,base);assert.equal(env.GIT_CONFIG_COUNT,'3');
 assert.equal(env.GIT_CONFIG_KEY_0,'core.autocrlf');assert.equal(env.GIT_CONFIG_VALUE_0,'false');
 assert.equal(env.GIT_CONFIG_VALUE_1,'');assert.match(env.GIT_CONFIG_VALUE_2,/^AUTHORIZATION: basic /);
 for(const count of ['-1','x','1.5','1025'])assert.throws(()=>libraryWriteGitEnvironment(dummy,{GIT_CONFIG_COUNT:count}),/Invalid inherited/);
});
