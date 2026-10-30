import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {packageNativeTool} from '../native-tool.mjs';
import {terrainDemCheckSources} from './terrain-dem-check.mjs';

const {values}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'}}});
if(!values.binary||!values.directory)throw Error('--binary FILE and --directory NEW_DIRECTORY required');
console.log(JSON.stringify(packageNativeTool({binary:values.binary,directory:values.directory,target:'terrain-dem-check',platform:process.platform,
  architecture:process.arch,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:terrainDemCheckSources})));
