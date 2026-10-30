// Explicit, source-pinned terrain preview generation and verification.
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateTerrainPreviewSources} from './gis/terrain-preview-sources.mjs';
import {buildTerrainPreview,readTerrainPreviewFiles,verifyTerrainPreviewFiles,writeTerrainPreview} from './gis/terrain-preview-builder.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export function parseTerrainPreviewArgs(args){
  const options={mode:'build',output:resolve(root,'assets/data/terrain-preview/v0.13.3-p2'),cache:resolve(root,'.terrain-preview-cache/source')};
  let mode=false;const seen=new Set();
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--check'||arg==='--rebuild-check'){
      if(mode)throw Error('Only one preview mode may be selected');mode=true;options.mode=arg.slice(2);
    }else if(arg==='--output'||arg==='--cache'){
      if(seen.has(arg)||!args[i+1]||args[i+1].startsWith('--'))throw Error('Expected one value for '+arg);
      seen.add(arg);options[arg.slice(2)]=resolve(args[++i]);
    }else throw Error('Unknown terrain preview argument: '+arg);
  }
  return options;
}
export async function runTerrainPreview(args=process.argv.slice(2)){
  const options=parseTerrainPreviewArgs(args);
  const dem=JSON.parse(readFileSync(resolve(root,'contracts/terrain/preview-dem-source.json')));
  const inventory=JSON.parse(readFileSync(resolve(root,'contracts/terrain/preview-dem-inventory.json')));
  const countryBytes=readFileSync(resolve(root,'assets/data/countries-ne-5.1.1.geojson'));
  const source=validateTerrainPreviewSources({dem,inventory,countryBytes});
  if(options.mode==='check'||options.mode==='rebuild-check'){
    const receipt=await verifyTerrainPreviewFiles({source,files:readTerrainPreviewFiles(options.output)});
    if(options.mode==='rebuild-check'){
      const rebuilt=await buildTerrainPreview({source,cache:options.cache});
      if(rebuilt.manifestSha256!==receipt.manifestSha256||rebuilt.tileBytes!==receipt.tileBytes||
        rebuilt.totalBytes!==receipt.totalBytes||rebuilt.tiles.length!==receipt.tiles)
        throw Error('Rebuilt preview differs from committed bytes');
      return {...receipt,reproducible:true};
    }
    return receipt;
  }
  if(existsSync(options.output))throw Error('Refusing to overwrite existing preview');
  const result=await buildTerrainPreview({source,cache:options.cache});
  return writeTerrainPreview({source,result,output:options.output});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await runTerrainPreview()));}
  catch(error){console.error('terrain-preview: '+error.message);process.exitCode=1;}
}
