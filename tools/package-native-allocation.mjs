// CI artifact packaging for the standalone read-only Windows metadata tool.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants,copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {allocationSourceFiles} from './pc-file-allocation.mjs';
const {values}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'}}});
if(!values.binary||!values.directory)throw Error('--binary FILE --directory NEW_ARTIFACT_DIRECTORY required');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const directory=resolve(values.directory),binary=resolve(values.binary),name=basename(binary),bytes=readFileSync(binary);
mkdirSync(directory,{recursive:true});copyFileSync(binary,join(directory,name),constants.COPYFILE_EXCL);
const manifest={schemaVersion:1,target:'pc-allocation',platform:'win32',architecture:'x64',
  revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  sourceFiles:allocationSourceFiles.map(path=>({path,normalization:'lf',sha256:sha(readFileSync(path,'utf8').replaceAll('\r\n','\n'))})),
  files:[{path:name,bytes:bytes.length,sha256:sha(bytes)}]};
writeFileSync(join(directory,'native-tool.manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(manifest));
