import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,symlinkSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,join} from 'node:path';
import {buildCommand,parseArguments,runSource,ROOT,TASK_SOURCES} from '../../scripts/gis/run-source.mjs';

test('GIS launcher uses an allowlist and dry-run never launches source commands',()=>{
 const calls=[],logs=[];
 const code=runSource({argv:['--task','terrain-dem','--','--etopo','/not-mounted/source.tif'],
   spawn:()=>{calls.push('called');throw Error('unsafe');},output:s=>logs.push(JSON.parse(s))});
 assert.equal(code,0);
 assert.equal(calls.length,0);
 assert.equal(logs[0].mode,'dry-run');
 assert.equal(logs[0].source,'tools/build-terrain-dem.py');
 assert.deepEqual(logs[0].argv,['--etopo','/not-mounted/source.tif']);
 assert.equal(logs[0].requiresExternalOriginals,false);
});
test('native Node tools and not-yet-migrated Python GIS tools use their own interpreters',()=>{
 for(const task of Object.keys(TASK_SOURCES)) {
   const cmd=buildCommand(task,[]);
   assert.ok(cmd[1].startsWith(ROOT));
   if(TASK_SOURCES[task].endsWith('.mjs'))assert.equal(cmd[0],process.execPath);
   else assert.match(cmd[0],/python/i);
 }
 assert.match(buildCommand('place-candidates',[])[1],/build-place-candidates\.mjs$/);
 assert.match(buildCommand('hydro-packfile',[])[1],/build-hydro-packfile\.mjs$/);
});
test('GIS raw subprocess launch requires explicit --execute and keeps forwarded args',()=>{
 const logs=[],calls=[];
 const status=runSource({argv:['--task','place-candidates','--execute','--','review','--cache','/tmp/staging'],
   output:s=>logs.push(JSON.parse(s)),
   spawn:(exe,args,options)=>{calls.push({exe,args,options});return {status:7,signal:null};}});
 assert.equal(status,7);assert.equal(logs[0].mode,'execute');
 assert.equal(logs[0].requiresExternalOriginals,true);
 assert.deepEqual(logs[0].argv,['review','--cache','/tmp/staging']);
 assert.equal(calls.length,1);
 assert.equal(calls[0].exe,process.execPath);
 assert.deepEqual(calls[0].args.slice(1),['review','--cache','/tmp/staging']);
 assert.equal(calls[0].options.shell,false);
});
test('retired and arbitrary Python entrypoints cannot be dispatched',()=>{
 for(const argv of [['--task','historical-topography-probe'],['--task','scripts/backdoor.py','--execute']])
   assert.throws(()=>parseArguments(argv),/invalid choice/);
 assert.throws(()=>parseArguments(['--task','terrain-dem','--unknown']),/Unknown/);
});
test('mapped scripts cannot follow linked directories outside an explicit repository root',t=>{
 const root=mkdtempSync(join(tmpdir(),'gis-dispatch-root-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const outside=join(root,'../'+basename(root)+'-out-of-tree');
 mkdirSync(outside);
 writeFileSync(join(outside,'build-terrain-dem.py'),'# external fixture');
 t.after(()=>rmSync(outside,{recursive:true,force:true}));
 symlinkSync(outside,join(root,'tools'),process.platform==='win32'?'junction':'dir');
 assert.throws(()=>buildCommand('terrain-dem',[],{root}),/escaped repository/);
});

test('historical-border dispatches the migrated Node recipe owner without restoring Python',t=>{
 const root=mkdtempSync(join(tmpdir(),'gis-native-recipe-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source='tools/gis/build-german-1914-base.mjs';
 mkdirSync(join(root,'tools/gis'),{recursive:true});
 writeFileSync(join(root,source),"throw Error('fixture must not execute');\n");
 const calls=[],logs=[],args=['--recipe','tools/historical-library/german-empire-1914-base.recipe.json','--check'];
 const options={root,output:s=>logs.push(JSON.parse(s)),spawn:(exe,argv,settings)=>{calls.push({exe,argv,settings});return {status:0,signal:null};}};
 assert.equal(runSource({...options,argv:['--task','historical-border','--',...args]}),0);
 assert.equal(calls.length,0);assert.equal(logs[0].source,source);
 assert.equal(logs[0].requiresExternalOriginals,false);
 assert.equal(runSource({...options,argv:['--task','historical-border','--execute','--',...args]}),0);
 assert.equal(calls.length,1);assert.equal(calls[0].exe,process.execPath);
 assert.equal(calls[0].argv[0],join(root,source));assert.deepEqual(calls[0].argv.slice(1),args);
 assert.equal(calls[0].settings.shell,false);assert.equal(logs[1].requiresExternalOriginals,true);
});
