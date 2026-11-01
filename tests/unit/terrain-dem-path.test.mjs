import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,rm,symlink} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import test from 'node:test';
import {futureRealpath} from '../../tools/gis/build-physical-hydro.mjs';
import {rebuildTerrainDemTint} from '../../tools/gis/terrain-dem-build.mjs';

test('DEM reuse cannot write through a junction into its source directory',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-dem-path-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'source'),alias=join(root,'alias');await mkdir(source);
  await symlink(source,alias,process.platform==='win32'?'junction':'dir');
  const destination=join(alias,'nested');
  try{
    await assert.rejects(rebuildTerrainDemTint({sourceOutput:source,output:destination,tintZip:'missing',ice:'missing',countries:'missing'}),/inside/i);
  }catch(error){
    console.error('DEM path diagnostics:',JSON.stringify({source,asyncRealpath:await realpath(source),nativeRealpath:realpathSync.native(source),
      resolved:futureRealpath(destination),relative:relative(await realpath(source),futureRealpath(destination))}));
    throw error;
  }
});
