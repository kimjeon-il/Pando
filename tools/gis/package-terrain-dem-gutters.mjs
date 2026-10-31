import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {packageNativeTool} from '../native-tool.mjs';
import {terrainDemGutterSources} from './terrain-dem-gutters.mjs';
const {values}=parseArgs({options:{binary:{type:'string'},directory:{type:'string'}}});
if(!values.binary||!values.directory)throw Error('--binary FILE --directory NEW_ARTIFACT_DIRECTORY required');
console.log(JSON.stringify(packageNativeTool({binary:values.binary,directory:values.directory,target:'terrain-dem-gutters',
  platform:process.platform,architecture:process.arch,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:terrainDemGutterSources})));
