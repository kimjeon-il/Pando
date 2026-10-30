import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {packageNativeTool} from '../native-tool.mjs';
import {mapPreviewSourceFiles} from './native-preview.mjs';

const {values}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'}}});
if(!values.binary||!values.directory)throw Error('binary and directory are required');
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
packageNativeTool({binary:values.binary,directory:values.directory,root:process.cwd(),target:'map-preview',platform:process.platform,
  architecture:process.arch,revision,sourceFiles:mapPreviewSourceFiles,runtimeVersion:'freetype-2.14.3'});
