import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url),q=createRequire(require.resolve('@playwright/test')),p=createRequire(q.resolve('playwright'));
const {PNG}=require(dirname(p.resolve('playwright-core/package.json'))+'/lib/utilsBundle.js');
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Missing evidence path');const a=JSON.parse(readFileSync(base+'/p4-analysis.json'));
const sample=k=>{const r=a.conditions[k].first.find(x=>x.cacheHit===true);if(!r)throw Error('No cache hit '+k);return r.run+'-0.png';};
const files=['A','B','A2'].map(sample),x=PNG.sync.read(readFileSync(base+'/'+files[0])),rows=[];
for(const file of files.slice(1)){const y=PNG.sync.read(readFileSync(base+'/'+file));if(x.width!==y.width||x.height!==y.height)throw Error('Image dimensions mismatch');let differing=0,maxDelta=0;for(let i=0;i<x.data.length;i+=4){let different=false;for(let c=0;c<4;c++){const d=Math.abs(x.data[i+c]-y.data[i+c]);different||=d>0;maxDelta=Math.max(maxDelta,d);}if(different)differing++;}rows.push({reference:files[0],file,width:x.width,height:x.height,differing,maxDelta});}
writeFileSync(base+'/pixel-comparison.json',JSON.stringify(rows,null,2));console.log('W4_PIXELS',JSON.stringify(rows));
