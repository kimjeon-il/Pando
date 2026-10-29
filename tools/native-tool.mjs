// Source-bound CI artifacts for optional tools; this module never builds or downloads.
import {constants,copyFileSync,lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {containedPath,contentHash} from './library-content.mjs';

export function packageNativeTool({binary,directory,root='.',target,platform,architecture,revision,sourceFiles,runtimeVersion}){
  const source=resolve(binary),destination=resolve(directory),name=basename(source),bytes=readFileSync(source);
  if(!/^[a-f0-9]{40}$/.test(revision)||!bytes.length)throw Error('Native artifact needs a revision and nonempty binary');
  const manifest={schemaVersion:1,target,platform,architecture,revision,
    sourceFiles:sourceFiles.map(path=>({path,normalization:'lf',sha256:contentHash(readFileSync(containedPath(root,path),'utf8').replaceAll('\r\n','\n'))})),
    files:[{path:name,bytes:bytes.length,sha256:contentHash(bytes)}]};
  if(runtimeVersion)manifest.runtimeVersion=runtimeVersion;
  mkdirSync(destination,{recursive:true});copyFileSync(source,join(destination,name),constants.COPYFILE_EXCL);
  writeFileSync(join(destination,'native-tool.manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return manifest;
}

export function verifyNativeTool({root,directory,target,executable,sourceFiles,platform=process.platform,architecture=process.arch}){
  const manifestPath=containedPath(directory,'native-tool.manifest.json');
  if(!lstatSync(manifestPath).isFile())throw Error('Native tool manifest must be a regular file');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  if(manifest.schemaVersion!==1||manifest.target!==target)throw Error('Native tool target/schema mismatch');
  if(manifest.platform!==platform||manifest.architecture!==architecture)throw Error('Native tool platform/architecture mismatch');
  if(!/^[a-f0-9]{40}$/.test(manifest.revision))throw Error('Native tool revision is missing');
  if(!Array.isArray(manifest.sourceFiles)||manifest.sourceFiles.length!==sourceFiles.length||
    manifest.sourceFiles.some((file,i)=>file.path!==sourceFiles[i]||file.normalization!=='lf'))throw Error('Native tool source inventory mismatch');
  for(const file of manifest.sourceFiles){
    const path=containedPath(root,file.path);
    if(!lstatSync(path).isFile()||contentHash(readFileSync(path,'utf8').replaceAll('\r\n','\n'))!==file.sha256)throw Error('Native tool source mismatch: '+file.path);
  }
  if(!Array.isArray(manifest.files)||manifest.files.length!==1||manifest.files[0].path!==executable)throw Error('Native tool file inventory mismatch');
  const file=manifest.files[0],binary=containedPath(directory,executable);
  if(!lstatSync(binary).isFile())throw Error('Native tool binary must be a regular file');
  const bytes=readFileSync(binary);
  if(!Number.isSafeInteger(file.bytes)||file.bytes<=0||bytes.length!==file.bytes||contentHash(bytes)!==file.sha256)throw Error('Native tool binary hash/size mismatch');
  return {binary,manifest};
}
