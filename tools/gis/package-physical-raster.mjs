import {parseArgs} from 'node:util';
import {packageNativeTool} from '../native-tool.mjs';
import {physicalRasterSources} from './physical-raster-native.mjs';

const {values}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'}}});
if(!values.binary||!values.directory)throw Error('Explicit binary and directory required');
console.log(JSON.stringify(packageNativeTool({binary:values.binary,directory:values.directory,target:'physical-raster',platform:process.platform,
  architecture:process.arch,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:physicalRasterSources})));
import {execFileSync} from 'node:child_process';
