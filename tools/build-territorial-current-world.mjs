import fs from 'node:fs';
import {buildCurrentWorld} from './territorial-current-world.mjs';
const output=new URL('../assets/data/territorial-entities/generated/current-world.geojson',import.meta.url);
const bytes=`${JSON.stringify(buildCurrentWorld())}\n`;
if(process.argv.includes('--check')){if(fs.readFileSync(output,'utf8').replaceAll('\r\n','\n')!==bytes)throw new Error('Stale current world collection');}
else fs.writeFileSync(output,bytes);
console.log(`Current snapshot: ${JSON.parse(bytes).features.length} unchanged country features`);
