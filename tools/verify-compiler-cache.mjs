// Tiny real compiler probes, never the application or published WASM build.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compilerCacheEnvironment, storageSettings } from './worktree-storage.mjs';
import { atomicStorageJSON, contentHash, containedPath } from './library-content.mjs';
import { randomUUID } from 'node:crypto';

const roots=['D:/dev/worktrees/objects','D:/dev/worktrees/places'];
const settings=storageSettings(roots[0]),env=compilerCacheEnvironment({root:roots[0]});
env.COMPILER_PATH='C:/Users/taeeu/Qt/Tools/mingw1310_64/bin';
env.PATH=env.COMPILER_PATH+';'+(env.PATH||env.Path||'');
const compiler='C:/Users/taeeu/Qt/Tools/mingw1310_64/bin/g++.exe';
const rustc='D:/build/toolchains/rustup/toolchains/stable-x86_64-pc-windows-gnu/bin/rustc.exe';
const directories=roots.map(root=>containedPath(root,'build-native/cache-probe'));
const run=(tool,args,cwd,extra={})=>execFileSync(tool,args,{cwd,env:{...env,...extra},windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const stats=()=>JSON.parse(run(settings.tool,['--show-stats','--stats-format=json'],roots[0]));
const count=(s,kind)=>Object.values(s.stats[kind].counts).reduce((n,x)=>n+x,0);
const records=[];
const nonce=randomUUID();
function check(name,operation,kind){const before=stats();const value=operation();const after=stats();const hits=count(after,'cache_hits')-count(before,'cache_hits'),misses=count(after,'cache_misses')-count(before,'cache_misses');records.push({name,hits,misses,value});if(kind==='hit')assert.ok(hits>0,`${name}: expected cache hit`);if(kind==='miss')assert.ok(misses>0,`${name}: expected cache miss`);return value;}
try{
  for(const directory of directories){
    if(existsSync(directory))throw Error(`Preserve existing verification directory: ${directory}`);
    mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'.pando-cache-probe'),'owned');
    writeFileSync(join(directory,'value.h'),`// ${nonce}\nconstexpr int answer = 37;\n`);
    writeFileSync(join(directory,'library.cpp'),`#include "value.h"\nextern "C" const char* probe_tag(){return "${nonce}";}\nextern "C" int answer_value(){return answer;}\nextern "C" const char* source_path(){return __FILE__;}\n`);
    writeFileSync(join(directory,'main.cpp'),'#include <cstdio>\nextern "C" int answer_value(); extern "C" const char* source_path(); int main(){std::printf("%d:%s",answer_value(),source_path());}\n');
    writeFileSync(join(directory,'library.rs'),`pub fn probe_tag()-> &'static str{"${nonce}"} pub fn answer()->u32{37} pub fn source()-> &'static str{file!()} pub fn environment()-> &'static str{env!("PANDO_PROBE_ENV")}\n`);
    writeFileSync(join(directory,'main.rs'),'extern crate pando_cache_probe; fn main(){print!("{}:{}:{}",pando_cache_probe::answer(),pando_cache_probe::source(),pando_cache_probe::environment());}\n');
  }
  const cpp=(directory,args=[])=>run(settings.tool,[compiler,'-c','library.cpp','-o','library.o','-MMD','-MF','library.d',...args],directory);
  const cppResult=directory=>{run(compiler,['main.cpp','library.o','-o','probe.exe'],directory);return run(join(directory,'probe.exe'),[],directory);};
  check('C++ first compilation',()=>cpp(directories[0]),'miss');
  check('C++ repeated compilation',()=>cpp(directories[0]),'hit');
  check('C++ other worktree',()=>cpp(directories[1]),'hit');
  for(const directory of directories){assert.equal(cppResult(directory),'37:library.cpp');assert.match(readFileSync(join(directory,'library.d'),'utf8'),/library\.cpp.*value\.h/s);}
  writeFileSync(join(directories[1],'value.h'),'constexpr int answer = 41;\n');
  check('C++ changed header',()=>cpp(directories[1]),'miss');assert.equal(cppResult(directories[1]),'41:library.cpp');assert.equal(cppResult(directories[0]),'37:library.cpp');
  check('C++ changed options',()=>cpp(directories[0],['-O2']),'miss');
  // Registry dependencies have one canonical source/cwd while each branch owns
  // its output directory. Workspace cwd stays in Rust's key and is not weakened.
  const dependency=directories[0];
  const rust=(directory,extra={})=>run(settings.tool,[rustc,'--edition=2021','--crate-name','pando_cache_probe','--crate-type','rlib','library.rs','--emit=link,dep-info','--out-dir',directory],dependency,{PANDO_PROBE_ENV:'same',...extra});
  const rustResult=directory=>{run(rustc,['--edition=2021','main.rs','--extern','pando_cache_probe=libpando_cache_probe.rlib','-C',`linker=${compiler.replace('g++.exe','gcc.exe')}`,'-o','rust-probe.exe'],directory);return run(join(directory,'rust-probe.exe'),[],directory);};
  check('Rust first dependency compilation',()=>rust(directories[0]),'miss');
  check('Rust repeated dependency compilation',()=>rust(directories[0]),'hit');
  check('Rust other worktree',()=>rust(directories[1]),'hit');
  for(const directory of directories){assert.equal(rustResult(directory),'37:library.rs:same');assert.match(readFileSync(join(directory,'pando_cache_probe.d'),'utf8'),/library\.rs/);}
  check('Rust changed env! input',()=>rust(directories[1],{PANDO_PROBE_ENV:'changed'}),'miss');
  assert.equal(rustResult(directories[1]),'37:library.rs:changed');assert.equal(rustResult(directories[0]),'37:library.rs:same');
  writeFileSync(join(dependency,'library.rs'),readFileSync(join(dependency,'library.rs'),'utf8').replace('answer()->u32{37}','answer()->u32{43}'));
  check('Rust changed source',()=>rust(directories[1]),'miss');assert.equal(rustResult(directories[1]),'43:library.rs:same');
  const cmakeVersion=JSON.parse(readFileSync(join(roots[0],'config/toolchain-versions.json'),'utf8')).cmake;
  const cmake=join('D:/build/toolchains/cmake',cmakeVersion,'bin/cmake.exe');
  writeFileSync(join(directories[0],'CMakeLists.txt'),`cmake_minimum_required(VERSION 3.21)\nproject(CacheProbe LANGUAGES CXX)\ninclude("${roots[0]}/cmake/compiler-cache.cmake")\nadd_library(probe STATIC library.cpp)\n`);
  run(cmake,['-S','.','-B','cmake','-G','MinGW Makefiles',`-DCMAKE_CXX_COMPILER=${compiler}`,`-DCMAKE_MAKE_PROGRAM=${env.COMPILER_PATH}/mingw32-make.exe`],directories[0]);
  const build=()=>run(cmake,['--build','cmake','--verbose'],directories[0]);
  const log=build();assert.match(log,/sccache\.exe/);
  unlinkSync(join(directories[0],'cmake/CMakeFiles/probe.dir/library.cpp.obj'));
  check('CMake persisted owned launcher',build,'hit');
  const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);
  const result={at:new Date().toISOString(),records,stats:stats(),toolSha256:contentHash(readFileSync(settings.tool))};
  if(output)atomicStorageJSON(resolve(output),result);console.log(JSON.stringify(result,null,2));
}finally{
  for(const directory of directories)if(existsSync(join(directory,'.pando-cache-probe')))rmSync(directory,{recursive:true});
}
