import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function checkUSSRPartition({root=resolve(fileURLToPath(new URL('../',import.meta.url))),
  env=process.env,platform=process.platform,exists=existsSync,
  run=(argv,options)=>spawnSync(argv[0],argv.slice(1),{...options,stdio:'inherit',shell:false})}={}){
  const build=join(root,'build-native/territorial-recipe');
  let binary=env.PANDO_TERRITORIAL_RECIPE_BINARY;
  const execute=(argv,environment=env)=>{
    const result=run(argv,{cwd:root,env:environment});
    if(result.error||result.status!==0)throw Error('USSR partition prerequisite/check failed: '+argv.join(' ')+': '+(result.error?.message||result.status));
  };
  if(!binary){
    execute(['cmake','-S','tools/cpp','-B',build,
      '-DPANDO_BUILD_COUNTRY_VALIDATOR=OFF','-DPANDO_BUILD_TERRITORIAL_RECIPE=ON']);
    execute(['cmake','--build',build,'--config','Release','--target','pando-territorial-recipe']);
    binary=[join(build,platform==='win32'?'pando-territorial-recipe.exe':'pando-territorial-recipe'),
      join(build,'Release/pando-territorial-recipe.exe')].find(exists);
  }
  if(!binary||!exists(binary))throw Error('USSR partition native executable is missing');
  execute([process.execPath,'--test','tests/unit/gis-ussr-1922-partition-native.test.mjs'],
    {...env,PANDO_TERRITORIAL_RECIPE_BINARY:binary});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{checkUSSRPartition();}catch(error){console.error(error.message);process.exitCode=1;}
}
