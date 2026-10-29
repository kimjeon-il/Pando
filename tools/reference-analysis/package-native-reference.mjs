import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {packageNativeTool} from '../native-tool.mjs';
import {referenceProofSourceFiles,referenceSourceFiles} from './native-infer.mjs';

const {values}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'},kind:{type:'string',default:'inference'}}});
if(!values.binary||!values.directory)throw Error('--binary FILE --directory NEW_ARTIFACT_DIRECTORY required');
if(!['inference','training-proof'].includes(values.kind))throw Error('Unknown native reference artifact kind');
const proof=values.kind==='training-proof';
const manifest=packageNativeTool({binary:values.binary,directory:values.directory,target:proof?'reference-training-proof':'reference-infer',platform:'win32',architecture:'x64',runtimeVersion:'2.14.1',
  revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:proof?referenceProofSourceFiles:referenceSourceFiles});
console.log(JSON.stringify(manifest));
