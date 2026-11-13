// One-shot CI publisher for a generated natural-terrain edition.
// Never changes the app's operational data pin, main, or an existing edition.
import {readFileSync,writeFileSync,existsSync,cpSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {validateNaturalSurfaceManifest,terrainNaturalTileRequest,fetchTerrainTile} from '../src/data/terrain-manifest.js';

const root=process.env.RUNNER_TEMP, token=process.env.LIBRARY_TOKEN;
const edition=process.env.OUT_EDITION, catalog=process.env.CATALOG;
const base=resolve('.natural-library'), source=resolve(root||'.','natural-world-candidate');
const proof=resolve(root||'.','natural-world-proof'), beforePath=resolve(proof,'library-before.txt');
const mode=process.argv[2];

if(!root || !edition?.startsWith('terrain/natural/v0.2.0-world.1')
    || catalog!=='terrain/natural/candidates/v0.2.0-world.1.json')
  throw Error('Pinned CI terrain candidate environment required');
const revision=()=>readFileSync(resolve(proof,'source-revision.txt'),'utf8').trim();
const newCatalogRevision=()=>readFileSync(resolve(proof,'catalog-revision.txt'),'utf8').trim();
const manifest=JSON.parse(readFileSync(resolve(source,'manifest.json'),'utf8'));
assert.equal(Object.keys(manifest.tiles).length,1280);
validateNaturalSurfaceManifest({...manifest,sourceRevision:'0'.repeat(40)},manifest);

function command(args,authenticated=false) {
  const env={...process.env};
  if(authenticated){
    if(!token)throw Error('Scoped external library write token unavailable');
    // A token-bearing URL or process argument would leak into failed git
    // subprocess diagnostics. Let an ephemeral askpass helper read the token
    // from the CI environment without putting credentials in argv/logs.
    const helper=resolve(root,'natural-world-askpass.sh');
    if(!existsSync(helper))writeFileSync(helper,
      '#!/bin/sh\\ncase "$1" in\\n  *sername*) printf "x-access-token\\n";;\\n  *assword*) printf "%s\\n" "$LIBRARY_TOKEN";;\\n  *) exit 1;;\\nesac\\n',
      {mode:0o700});
    env.GIT_ASKPASS=helper;
    env.GIT_TERMINAL_PROMPT='0';
  }
  return execFileSync('git',['-C',base,...args],{env,encoding:'utf8',timeout:900_000,maxBuffer:16*1024*1024}).trim();
}
const remoteHead=()=>command(['ls-remote','--exit-code','origin','refs/heads/work/gis'],true).split(/\s+/)[0];

if(mode==='publish'){
  assert(!existsSync(resolve(base,edition)),'Never overwrite an existing external edition');
  assert(!existsSync(resolve(base,catalog)),'Never overwrite an existing candidate catalog');
  const before=readFileSync(beforePath,'utf8').trim();
  assert.equal(command(['rev-parse','HEAD']),before);
  assert.equal(remoteHead(),before,'External data branch advanced; preserve concurrent edits');
  const total=Object.values(manifest.tiles).reduce((n,t)=>n+t.bytes,0);
  assert(total<2*1024**3,'Bounded global edition exceeds 2 GiB transfer guard');
  cpSync(source,resolve(base,edition),{recursive:true,errorOnExist:true,force:false});
  command(['add','--sparse','--',edition]);
  command(['diff','--cached','--check']);
  const staged=command(['diff','--cached','--name-only']).split('\n');
  assert.equal(staged.length,1282,'Expected all 1280 WebP tiles and two metadata files');
  assert(staged.every(path=>path.startsWith(edition+'/')),'Unexpected external files were staged');
  command(['-c','user.name=Pando natural terrain builder',
    '-c','user.email=pando-terrain@users.noreply.github.com',
    'commit','-m','data(terrain): immutable all-world six-LOD BMNG with observed samples']);
  const contentRevision=command(['rev-parse','HEAD']);
  command(['push','origin','HEAD:refs/heads/work/gis'],true);
  assert.equal(remoteHead(),contentRevision);
  writeFileSync(resolve(proof,'source-revision.txt'),contentRevision+'\n');
  console.log('WORLD_NATURAL_SOURCE_REVISION='+contentRevision);

  // A separate immutable catalog contains the data commit. This is required
  // because a manifest cannot contain the SHA of the commit that stores itself.
  assert.equal(remoteHead(),contentRevision);
  const candidate={...manifest,sourceRevision:contentRevision,
    activation:'opt-in only: worldwide 2004 NASA base, 2021 masks at nine declared review regions'};
  const dest=resolve(base,catalog);mkdirSync(dirname(dest),{recursive:true});
  writeFileSync(dest,JSON.stringify(candidate,null,2)+'\n',{flag:'wx'});
  command(['add','--sparse','--',catalog]);
  command(['-c','user.name=Pando natural terrain builder',
    '-c','user.email=pando-terrain@users.noreply.github.com',
    'commit','-m','data(terrain): pin all-world natural preview to immutable content commit']);
  const catalogRevision=command(['rev-parse','HEAD']);
  command(['push','origin','HEAD:refs/heads/work/gis'],true);
  assert.equal(remoteHead(),catalogRevision);
  writeFileSync(resolve(proof,'catalog-revision.txt'),catalogRevision+'\n');
  console.log('WORLD_NATURAL_CATALOG_REVISION='+catalogRevision);
}else if(mode==='verify'){
  const dataRevision=revision(),catalogRevision=newCatalogRevision();
  const url='https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/'+catalogRevision+'/'+catalog;
  let response=null;
  for(let attempt=0;attempt<5;attempt++){
    response=await fetch(url,{signal:AbortSignal.timeout(60000)});
    if(response.ok)break;
    await new Promise(r=>setTimeout(r,1000*(attempt+1)));
  }
  assert.equal(response.status,200,'Published candidate catalog unavailable');
  const admitted=validateNaturalSurfaceManifest(await response.json(),manifest);
  assert.equal(admitted.sourceRevision,dataRevision);
  const samples=[];
  for(const key of ['0/0-0.webp','3/5-3.webp','4/15-3.webp','4/7-0.webp','5/30-6.webp','5/14-0.webp']){
    const [,level,column,row]=/^(\d+)\/(\d+)-(\d+)\.webp$/.exec(key).map(Number);
    const record=admitted.tiles[key];
    const request=terrainNaturalTileRequest({
      level,column,row,pixelWidth:record.pixelWidth-2,pixelHeight:record.pixelHeight-2
    },{...manifest,naturalSurface:admitted});
    const blob=await fetchTerrainTile(request,{signal:AbortSignal.timeout(60000)});
    assert.equal(blob.size,record.bytes);
    samples.push({key,bytes:blob.size,sha256:record.sha256});
  }
  writeFileSync(resolve(proof,'remote-readback.json'),JSON.stringify({
    status:'verified-worldwide-BMNG-preview-only',
    catalogRevision,sourceRevision:dataRevision,sourceNativeLodMax:4,
    worldCoverGlobalComplete:false,globalGlacierAndPolarComplete:false,
    samples,mainChanged:false,operationalPinChanged:false
  },null,2)+'\n');
  console.log('WORLD_NATURAL_REMOTE_READBACK_SUCCESS');
}else{
  throw Error('Use publish or verify');
}
