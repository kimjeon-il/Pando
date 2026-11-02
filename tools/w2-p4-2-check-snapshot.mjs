import {instrument} from './w2-p4-2-instrument.mjs';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Missing evidence path');const rows=[];
for(const [label,stepBytes] of [['A',262144],['B',1048576],['A2',262144]]){
 const dir=base+'/instrumented-'+label+'-v2';for(const file of readdirSync(dir)){
  const path=file.replaceAll('__','/'),source=readFileSync('D:/dev/worktrees/w2-p3-after/'+path,'utf8');
  const expected=readFileSync(dir+'/'+file,'utf8');assert.equal(instrument(path,source,{stepBytes,early:false}),expected,label+': '+path);rows.push({label,path,matched:true});
 }
}
writeFileSync(base+'/snapshot-reproducibility.json',JSON.stringify({passed:true,rows},null,2));console.log('W4_SNAPSHOT_REPRODUCIBLE',rows.length);
