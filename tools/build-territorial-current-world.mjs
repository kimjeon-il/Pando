import { writeLibraryOutput } from './library-data.mjs';
import fs from 'node:fs';
import {buildCurrentWorld} from './territorial-current-world.mjs';
const output=new URL('../assets/data/territorial-entities/generated/current-world.geojson',import.meta.url);
const bytes=`${JSON.stringify(buildCurrentWorld())}\n`;
if(process.argv.includes('--check')){if(fs.readFileSync(output,'utf8').replaceAll('\r\n','\n')!==bytes)throw new Error('Stale current world collection');}
else writeLibraryOutput(output,bytes);
console.log(`Derived world view: ${JSON.parse(bytes).features.length} explicitly selected country versions`);
