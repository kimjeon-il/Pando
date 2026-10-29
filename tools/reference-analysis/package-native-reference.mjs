import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {packageNativeTool} from '../native-tool.mjs';
import {referenceSourceFiles} from './native-infer.mjs';

const {values}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'}}});
if(!values.binary||!values.directory)throw Error('--binary FILE --directory NEW_ARTIFACT_DIRECTORY required');
const manifest=packageNativeTool({binary:values.binary,directory:values.directory,target:'reference-infer',platform:'win32',architecture:'x64',runtimeVersion:'2.14.1',
  revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:referenceSourceFiles});
console.log(JSON.stringify(manifest));
