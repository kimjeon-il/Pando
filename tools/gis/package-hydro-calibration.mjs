import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {packageNativeTool} from "../build/native-tool.mjs";
import {hydroCalibrationSources} from './hydro-calibration-native.mjs';

const {values}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'}}});
if(!values.binary||!values.directory)throw Error('--binary FILE --directory NEW_ARTIFACT_DIRECTORY required');
console.log(JSON.stringify(packageNativeTool({binary:values.binary,directory:values.directory,target:'hydro-calibration',
  platform:process.platform,architecture:process.arch,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:hydroCalibrationSources})));
