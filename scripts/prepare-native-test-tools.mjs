import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFileSync,existsSync,lstatSync,mkdirSync,readFileSync,statfsSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {nativeTestRecipe} from './lib/native-test-prerequisites.mjs';
import {verifyNativeTool} from '../tools/native-tool.mjs';

const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function regular(path) {if(!lstatSync(path).isFile())throw Error('Native prerequisite must be a regular file: '+path);}
function checkedRuntime(root,runtime) {
  const path=resolve(root,runtime.path);regular(path);
  if(hash(path)!==runtime.sha256)throw Error('Native SDK runtime hash mismatch: '+runtime.path);
}
async function sdkReady(root,sdk) {
  const archive=resolve(root,sdk.archive);
  if(!existsSync(archive))return false;
  regular(archive);if(hash(archive)!==sdk.sha256)throw Error('Native SDK archive SHA-256 mismatch: '+sdk.archive);
  if(!existsSync(resolve(root,sdk.extracted||sdk.runtime.path)))return false;
  if(sdk.runtime)checkedRuntime(root,sdk.runtime);
  if(sdk.runtimeVersion) {
    const {matchingTorchLibrary}=await import('../tools/reference-analysis/native-infer.mjs');
    matchingTorchLibrary(join(root,sdk.extracted,'lib'),{runtimeVersion:sdk.runtimeVersion});
  }
  return true;
}
function requireCapacity(root,additionalBytes) {
  if(additionalBytes<1024**3)return;
  const disk=statfsSync(root,{bigint:true}),available=disk.bavail*disk.bsize;
  if(available<BigInt(additionalBytes+5*1024**3))throw Error('Selected native preparation needs '+additionalBytes+' additional bytes plus 5 GiB headroom');
}
async function pinnedNativeInput(root,path,expectedSha) {
  const {extractArchived}=await import('../tools/gis/verify-german-1914-originals.mjs');
  const config=JSON.parse(readFileSync(resolve(root,'config/library-data.json'),'utf8'));
  if(!/^[\w-]+\/[\w.-]+$/.test(config.repository)||!/^[a-f0-9]{40}$/.test(config.revision))throw Error('Invalid pinned library configuration');
  const get=async path=>{
    const response=await fetch('https://raw.githubusercontent.com/'+config.repository+'/'+config.revision+'/'+path,{signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw Error('Pinned native test source HTTP '+response.status);
    if(Number(response.headers.get('content-length')||0)>32*1024**2)throw Error('Pinned native test source exceeds its archive budget');
    const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>32*1024**2)throw Error('Pinned native test source exceeds its archive budget');
    return bytes;
  };
  const index=JSON.parse((await get('archive/index.json')).toString('utf8')),entry=index.files?.[path];
  if(entry?.sha256!==expectedSha||!(entry.stored===path||/^archive\/blobs\/[a-f0-9]{64}\.(?:gz|bin)$/.test(entry.stored)))throw Error('Pinned native test source differs: '+path);
  return {...extractArchived(index,path,await get(entry.stored)),revision:config.revision};
}
async function preservePinnedNativeInput(root,path,expectedSha,destination) {
  if(existsSync(destination)) {
    regular(destination);if(hash(destination)!==expectedSha)throw Error('Existing native test source differs: '+destination);
    return {sha256:expectedSha,reused:true};
  }
  const prepared=resolve(root,path);
  let source;
  if(existsSync(prepared)) {
    regular(prepared);if(hash(prepared)!==expectedSha)throw Error('Prepared native test source differs: '+path);
    const bytes=readFileSync(prepared);source={bytes,sha256:expectedSha,decodedBytes:bytes.length};
  } else source=await pinnedNativeInput(root,path,expectedSha);
  mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,source.bytes,{flag:'wx'});
  return {revision:source.revision,sha256:source.sha256,bytes:source.decodedBytes};
}
export async function nativeTestCapacity(ids,{root=process.cwd(),probe=argv=>spawnSync(argv[0],argv.slice(1),
  {cwd:root,encoding:'utf8',timeout:10000})}={}) {
  if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))throw Error('Registered native prerequisite IDs must be an array');
  ids=[...new Set(ids)];for(const id of ids)nativeTestRecipe(id);
  let additionalBytes=0,recipeEnvironment=false;
  if(ids.includes('torch')&&!await sdkReady(root,nativeTestRecipe('torch').sdk))additionalBytes+=4*1024**3;
  if(ids.includes('territorial-recipe')) {
    const result=probe([process.env.MAMBA_EXE||'micromamba','run','-n','pando-territorial-recipe','pkg-config','--modversion','geos','proj']);
    recipeEnvironment=result.status!==0||Boolean(result.error)||result.stdout.trim()!=='3.13.1\n9.5.1';
    if(recipeEnvironment)additionalBytes+=2*1024**3;
  }
  const gdalEnvironment=ids.includes('terrain-dem-fill')||ids.includes('terrain-dem-tint');
  if(gdalEnvironment) {
    const result=probe([process.env.MAMBA_EXE||'micromamba','run','-n','pando-dem-gdal','gdal-config','--version']);
    if(result.status!==0||result.error||result.stdout.trim()!=='3.13.3')additionalBytes+=2*1024**3;
  }
  requireCapacity(root,additionalBytes);
  return {tools:ids.length>0,recipeEnvironment,gdalEnvironment,additionalBytes};
}

export async function prepareNativeTestTool(id,{root=process.cwd(),run=(argv)=>{
  const result=spawnSync(argv[0]==='node'?process.execPath:argv[0],argv.slice(1),{cwd:root,env:process.env,stdio:'inherit',shell:false});
  if(result.status!==0||result.error)throw Error('Native prerequisite command failed: '+argv.join(' '),{cause:result.error});
},platform=process.platform,architecture=process.arch}={}) {
  root=resolve(root);
  const recipe=nativeTestRecipe(id,{platform,architecture});
  const invoke=argv=>run(argv.map(arg=>arg.replaceAll('{root}',root)));
  const checkRuntime=runtime=>checkedRuntime(root,runtime);
  if(recipe.data==='german-natural-earth') {
    const {APPROVED_NE_SHA,PATHS}=await import('../tools/gis/verify-german-1914-originals.mjs');
    const destination=resolve(root,'build-native/german-base/canonical-ne.json');
    return {id,status:'prepared',...await preservePinnedNativeInput(root,PATHS.naturalEarth,APPROVED_NE_SHA,destination)};
  }
  if(recipe.data==='caspian-oracle') {
    const {ARCHIVE_SHA,MEMBER_SHA}=await import('../tools/gis/verify-approved-caspian-network.mjs');
    const {generateApprovedCaspianDisplay}=await import('../tools/gis/generalize-approved-caspian-display.mjs');
    const oracle=JSON.parse(readFileSync(resolve(root,'tests/fixtures/gis-caspian-1922-python-native-oracle.json'),'utf8'));
    if(oracle.sourceArchiveSha256!==ARCHIVE_SHA||oracle.sourceNetworkSha256!==MEMBER_SHA)throw Error('Caspian oracle source identity differs');
    const zip=resolve(root,'build-native/historical/approved-caspian-1922.zip');
    const source=await preservePinnedNativeInput(root,'tools/historical-library/sources/ussr-1922-approved/caspian-shoreline-completed-candidate-20261024.zip',ARCHIVE_SHA,zip);
    const output=resolve(root,'build-native/historical/caspian-1922-native-candidate.json');
    // Always execute the current native owner. A prior output alone does not
    // verify this source; it is retained only when the fresh computation agrees.
    const receipt=await generateApprovedCaspianDisplay(zip,{binary:resolve(root,'build-native/territorial-recipe/pando-territorial-recipe'),
      output:existsSync(output)?null:output});
    if(receipt.original.waterMemberSha256!==oracle.sourceWaterMemberSha256||hash(output)!==receipt.derivedSha256)
      throw Error('Current native Caspian oracle input or retained output differs');
    return {id,status:'prepared',source,receipt,scope:'ignored test fixture only; runtime and archive unchanged'};
  }
  if(recipe.sdk) {
    const sdk=recipe.sdk,archive=resolve(root,sdk.archive),destination=resolve(root,sdk.destination);
    if(await sdkReady(root,sdk))return {id,status:'reused',sdkSha256:sdk.sha256};
    if(sdk.minimumFreeBytes)requireCapacity(root,sdk.minimumFreeBytes-5*1024**3);
    mkdirSync(dirname(archive),{recursive:true});
    if(!existsSync(archive))invoke(['curl','--proto','=https','--tlsv1.2','--fail','--location','--retry','2','--max-time','180',
      '--max-filesize',String(sdk.maximumBytes),sdk.url,'--output',archive]);
    regular(archive);
    if(hash(archive)!==sdk.sha256)throw Error('Native SDK archive SHA-256 mismatch: '+sdk.archive);
    const extracted=resolve(root,sdk.extracted||sdk.runtime.path);
    if(!existsSync(extracted)) {mkdirSync(destination,{recursive:true});invoke(['unzip','-q',archive,'-d',destination]);}
    if(!await sdkReady(root,sdk))throw Error('Native SDK extraction is incomplete');
    return {id,status:'prepared',sdkSha256:sdk.sha256};
  }
  async function verifyArtifact() {
    const a=recipe.artifact,source=await import(pathToFileURL(resolve(root,a.sourceModule)).href);
    return verifyNativeTool({root,directory:resolve(root,a.directory),target:a.target,executable:a.executable,
      sourceFiles:source[a.sourceExport],platform,architecture});
  }
  if(recipe.artifact&&existsSync(resolve(root,recipe.artifact.directory))) {
    await verifyArtifact();
    if(recipe.runtime)checkRuntime(recipe.runtime);
    // The checkpoint inference fixture is not part of the packaged batch
    // manifest. Let its canonical CMake target track its own source changes.
    if(recipe.binaries?.length)for(const argv of recipe.commands)invoke(argv);
    for(const binary of recipe.binaries||[])regular(resolve(root,binary));
    return {id,status:'reused',directory:recipe.artifact.directory};
  }
  for(const argv of recipe.commands)invoke(argv);
  if(recipe.package) {invoke(recipe.package);await verifyArtifact();}
  if(recipe.runtime)checkRuntime(recipe.runtime);
  for(const binary of recipe.binaries||[])regular(resolve(root,binary));
  return {id,status:'prepared',directory:recipe.artifact?.directory,binaries:recipe.binaries};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2);
    if(args[0]==='--capacity') {
      if(args.length!==2&&!(args.length===3&&args[2]==='--github-output'))throw Error('Expected --capacity JSON_ARRAY [--github-output]');
      const result=await nativeTestCapacity(JSON.parse(args[1]));
      if(args[2]) {
        if(!process.env.GITHUB_OUTPUT)throw Error('GITHUB_OUTPUT is required');
        appendFileSync(process.env.GITHUB_OUTPUT,'tools='+result.tools+'\nrecipe_environment='+result.recipeEnvironment+'\ngdal_environment='+result.gdalEnvironment+'\n');
      }
      console.log(JSON.stringify(result));
    } else {
      if(args.length!==1)throw Error('One registered native prerequisite is required');
      console.log(JSON.stringify(await prepareNativeTestTool(args[0])));
    }
  } catch(error) {console.error(error.stack);process.exitCode=1;}
}
