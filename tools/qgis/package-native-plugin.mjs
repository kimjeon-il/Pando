import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {packageNativeTool} from '../native-tool.mjs';
import {qgisNativeSourceFiles} from './native-client.mjs';

const {values}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'}}});
if(!values.binary||!values.directory)throw Error('--binary FILE --directory NEW_ARTIFACT_DIRECTORY required');
console.log(JSON.stringify(packageNativeTool({binary:values.binary,directory:values.directory,target:'qgis-native-bridge',platform:'win32',architecture:'x64',
  runtimeVersion:'qgis-3.44.15-qt-5.15.13',revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:qgisNativeSourceFiles})));
