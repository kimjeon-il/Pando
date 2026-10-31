import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,symlinkSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,join} from 'node:path';
import {buildCommand,parseArguments,runSource,ROOT,TASK_SOURCES} from '../../scripts/gis/run-source.mjs';
import {packageNativeTool} from '../../tools/native-tool.mjs';
import {terrainDemEncodeSources} from '../../tools/gis/terrain-dem-encode.mjs';
import {terrainDemFillSources} from '../../tools/gis/terrain-dem-source.mjs';
import {terrainDemRasterSources} from '../../tools/gis/terrain-dem-raster.mjs';
import {terrainDemGutterSources} from '../../tools/gis/terrain-dem-gutters.mjs';
import {mapImageSourceFiles} from '../../tools/map-image/native-resample.mjs';

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
 assert.match(buildCommand('historical-border',[])[1],/build-german-1914-base\.mjs$/);
 const coast=buildCommand('historical-coast',['--output','candidate.json','--diagnostics','diagnostics.json']);
 assert.equal(coast[0],process.execPath);
 assert.match(coast[1],/build-german-1914-base\.mjs$/);
 assert.deepEqual(coast.slice(2),['--modern-coast','--output','candidate.json','--diagnostics','diagnostics.json']);
 assert.match(buildCommand('terrain-preview',[])[1],/build-terrain-preview\.mjs$/);
 assert.match(buildCommand('physical-data',[])[1],/build-physical-data\.mjs$/);
 assert.match(buildCommand('hydro-connectivity',[])[1],/repair-hydro-connectivity\.mjs$/);
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
test('terrain preview dispatcher invokes the Node owner with explicit arguments',()=>{
 const calls=[];
 assert.equal(runSource({argv:['--task','terrain-preview','--execute','--','--check'],output:()=>{},
   spawn:(exe,args,options)=>{calls.push({exe,args,options});return {status:0,signal:null};}}),0);
 assert.equal(calls[0].exe,process.execPath);
 assert.match(calls[0].args[0],/build-terrain-preview\.mjs$/);
 assert.deepEqual(calls[0].args.slice(1),['--check']);
});
test('DEM generation requires source-bound native elevation reading, encoding and tint filling',t=>{
 const root=mkdtempSync(join(tmpdir(),'gis-dem-dispatch-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const file of ['tools/build-terrain-dem.py',...terrainDemEncodeSources,...terrainDemFillSources,...terrainDemRasterSources,...terrainDemGutterSources,...mapImageSourceFiles]){mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),'fixture');}
 const argv=['--task','terrain-dem','--execute'],calls=[];
 assert.throws(()=>runSource({root,argv,output:()=>{},spawn:()=>{throw Error('must not run');}}),/ENOENT/);
 const binary=join(root,process.platform==='win32'?'pando-terrain-dem-encode.exe':'pando-terrain-dem-encode');writeFileSync(binary,'fixture binary');
 packageNativeTool({root,binary,directory:join(root,'build-native/terrain-dem-encode/artifact'),target:'terrain-dem-encode',platform:process.platform,
   architecture:process.arch,revision:'a'.repeat(40),sourceFiles:terrainDemEncodeSources});
 assert.throws(()=>runSource({root,argv,output:()=>{},spawn:()=>{throw Error('must not run');}}),/ENOENT/);
 const fill=join(root,process.platform==='win32'?'pando-terrain-dem-fill.exe':'pando-terrain-dem-fill');writeFileSync(fill,'fixture binary');
 packageNativeTool({root,binary:fill,directory:join(root,'build-native/terrain-dem-encode/fill-artifact'),target:'terrain-dem-fill',platform:process.platform,
   architecture:process.arch,revision:'a'.repeat(40),sourceFiles:terrainDemFillSources});
 assert.throws(()=>runSource({root,argv,output:()=>{},spawn:()=>{throw Error('must not run');}}),/ENOENT/);
 const raster=join(root,process.platform==='win32'?'pando-terrain-dem-raster.exe':'pando-terrain-dem-raster');writeFileSync(raster,'fixture binary');
 packageNativeTool({root,binary:raster,directory:join(root,'build-native/terrain-dem-raster/artifact'),target:'terrain-dem-raster',platform:process.platform,
   architecture:process.arch,revision:'a'.repeat(40),sourceFiles:terrainDemRasterSources});
 assert.throws(()=>runSource({root,argv,output:()=>{},spawn:()=>{throw Error('must not run');}}),/ENOENT/);
 const gutters=join(root,process.platform==='win32'?'pando-terrain-dem-gutters.exe':'pando-terrain-dem-gutters');writeFileSync(gutters,'fixture binary');
 packageNativeTool({root,binary:gutters,directory:join(root,'build-native/terrain-dem-gutters/artifact'),target:'terrain-dem-gutters',platform:process.platform,
   architecture:process.arch,revision:'a'.repeat(40),sourceFiles:terrainDemGutterSources});
 assert.throws(()=>runSource({root,argv,output:()=>{},spawn:()=>{throw Error('must not run');}}),/ENOENT/);
 const image=join(root,process.platform==='win32'?'pando-map-image.exe':'pando-map-image');writeFileSync(image,'fixture binary');
 packageNativeTool({root,binary:image,directory:join(root,'build-native/map-image/artifact'),target:'map-image',platform:process.platform,
   architecture:process.arch,revision:'a'.repeat(40),sourceFiles:mapImageSourceFiles});
 assert.equal(runSource({root,argv,output:()=>{},spawn:(exe,args,options)=>{calls.push(options);return {status:0,signal:null};}}),0);
 assert.equal(calls[0].env.PANDO_TERRAIN_DEM_ENCODE_BINARY,join(root,'build-native/terrain-dem-encode/artifact',basename(binary)));
 assert.equal(calls[0].env.PANDO_TERRAIN_DEM_FILL_DIRECTORY,join(root,'build-native/terrain-dem-encode/fill-artifact'));
 assert.equal(calls[0].env.PANDO_TERRAIN_DEM_RASTER_BINARY,join(root,'build-native/terrain-dem-raster/artifact',basename(raster)));
 assert.equal(calls[0].env.PANDO_TERRAIN_DEM_GUTTERS_DIRECTORY,join(root,'build-native/terrain-dem-gutters/artifact'));
 assert.equal(calls[0].env.PANDO_MAP_IMAGE_ARTIFACT,join(root,'build-native/map-image/artifact'));
});

test('tint-only DEM reuse does not require unrelated DEM reader or gutter binaries',t=>{
 const root=mkdtempSync(join(tmpdir(),'gis-dem-tint-only-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const file of ['tools/build-terrain-dem.py',...terrainDemEncodeSources,...terrainDemFillSources]){
   mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),'fixture');
 }
 for(const [target,sources,directory] of [['terrain-dem-encode',terrainDemEncodeSources,'artifact'],['terrain-dem-fill',terrainDemFillSources,'fill-artifact']]){
   const binary=join(root,`pando-${target}${process.platform==='win32'?'.exe':''}`);writeFileSync(binary,'fixture binary');
   packageNativeTool({root,binary,directory:join(root,'build-native/terrain-dem-encode',directory),target,platform:process.platform,
     architecture:process.arch,revision:'a'.repeat(40),sourceFiles:sources});
 }
 const calls=[];
 assert.equal(runSource({root,argv:['--task','terrain-dem','--execute','--','--reuse-dem=old'],output:()=>{},
   spawn:(exe,args,options)=>{calls.push(options);return {status:0,signal:null};}}),0);
 assert.equal(calls.length,1);
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
