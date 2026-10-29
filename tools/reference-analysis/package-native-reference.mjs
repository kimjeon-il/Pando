import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {packageNativeTool} from '../native-tool.mjs';
import {referenceOnnxTestSourceFiles,referenceProofSourceFiles,referenceSourceFiles} from './native-infer.mjs';

const {values}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'},kind:{type:'string',default:'inference'}}});
if(!values.binary||!values.directory)throw Error('--binary FILE --directory NEW_ARTIFACT_DIRECTORY required');
if(!['inference','training-proof','onnx-test'].includes(values.kind))throw Error('Unknown native reference artifact kind');
const proof=values.kind==='training-proof';
const onnx=values.kind==='onnx-test';
const manifest=packageNativeTool({binary:values.binary,directory:values.directory,target:proof?'reference-training-proof':onnx?'reference-onnx-tests':'reference-infer',platform:'win32',architecture:'x64',runtimeVersion:'2.14.1',
  revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:proof?referenceProofSourceFiles:onnx?referenceOnnxTestSourceFiles:referenceSourceFiles});
console.log(JSON.stringify(manifest));
