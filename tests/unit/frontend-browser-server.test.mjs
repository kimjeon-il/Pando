import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('browser verification serves generated viewer/editor entries and mapped modules',async t=>{
 const port=4189,child=spawn(process.execPath,['tests/browser/server.mjs'],{env:{...process.env,PANDOLAB_TEST_PORT:String(port)},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});
 const exited=once(child,'exit');t.after(async()=>{if(child.exitCode===null)child.kill();await exited;});
 let ready=false;for(let i=0;i<180;i++){if(child.exitCode!==null)throw Error(output);try{await fetch('http://127.0.0.1:'+port+'/__p3_health');ready=true;break;}catch{await new Promise(yes=>setTimeout(yes,500));}}
 assert.equal(ready,true,output);
 const viewer=await fetch('http://127.0.0.1:'+port+'/assets/js/viewer.js');assert.equal(viewer.status,200);
 const editor=await fetch('http://127.0.0.1:'+port+'/__editor/index.html');assert.equal(editor.status,200);assert.ok((await editor.text()).includes('assets/js/bootstrap.js'));
 assert.equal((await fetch('http://127.0.0.1:'+port+'/AGENTS.md')).status,404);
});
