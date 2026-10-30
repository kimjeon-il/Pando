import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {packageNativeTool} from '../native-tool.mjs';
import {evaluationSourceFiles} from './native-evaluation.mjs';

const {values}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'}}});
if(!values.binary||!values.directory)throw Error('binary and directory are required');
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
packageNativeTool({binary:values.binary,directory:values.directory,root:process.cwd(),target:'map-evaluation',platform:process.platform,
  architecture:process.arch,revision,sourceFiles:evaluationSourceFiles});
