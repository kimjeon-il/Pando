// Existing LSIB exclusions protect disputed or nonstandard source boundaries.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function classifyLSIBExclusion(properties,disputed){
  if(!properties||typeof properties!=='object'||Array.isArray(properties)||typeof disputed!=='boolean')throw Error('Explicit LSIB properties and dispute flag required');
  if(properties.RANK!=='1'||properties.STATUS!=='International Boundary')return 'special-or-separation-line';
  if(disputed)return 'existing-disputed-territory-or-protected-country-pair';
  const note=Object.hasOwn(properties,'NOTES')?properties.NOTES:'';if(typeof note!=='string')throw Error('LSIB note must be a string');
  const normalized=note.toLowerCase();
  if(['uncertain','condominium','neutral zone','invernada'].some(word=>normalized.includes(word)))return 'uncertain-or-joint-sovereignty';
  if(normalized.includes('island sovereignty'))return 'river-island-sovereignty-needs-independent-review';
  return null;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--stream')throw Error('Expected --stream');
    const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>32*1024*1024)throw Error('LSIB exclusion request exceeds byte budget');chunks.push(chunk);}
    const rows=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
    if(!Array.isArray(rows)||rows.length>100000)throw Error('Explicit bounded LSIB source records required');
    process.stdout.write(JSON.stringify(rows.map(row=>[classifyLSIBExclusion(row,false),classifyLSIBExclusion(row,true)]))+'\n');
  }catch(error){process.stderr.write('lsib-exclusion: '+String(error.message)+'\n');process.exitCode=1;}
}
