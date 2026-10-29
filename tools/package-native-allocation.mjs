// CI artifact packaging for the standalone read-only Windows metadata tool.
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {allocationSourceFiles} from './pc-file-allocation.mjs';
import {packageNativeTool} from './native-tool.mjs';
const {values}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'}}});
if(!values.binary||!values.directory)throw Error('--binary FILE --directory NEW_ARTIFACT_DIRECTORY required');
const manifest=packageNativeTool({binary:values.binary,directory:values.directory,target:'pc-allocation',platform:'win32',architecture:'x64',
  revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:allocationSourceFiles});
console.log(JSON.stringify(manifest));
