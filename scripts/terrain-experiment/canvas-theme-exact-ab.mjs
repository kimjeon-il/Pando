// Paired bounded conversion test. Earlier code is read from the immutable Git ref.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
const [base,output]=process.argv.slice(2);if(!/^[a-f0-9]{7,40}$/.test(base||'')||!output)throw Error('Expected immutable base commit and new output path');
const path='src/rendering/workers/canvas-terrain-dem-core.js';
const earlier=execFileSync('git',['show',`${base}:${path}`],{encoding:'utf8'}),current=await readFile(path,'utf8');
const make=source=>{const context={};new Function('self',source)(context);return context.PandoLabCanvasTerrainDem;};
const old=make(earlier),next=make(current),width=1026,height=1026,dem=new Uint8ClampedArray(width*height*4),hash=data=>createHash('sha256').update(data).digest('hex');
for(let i=0;i<dem.length;i+=4){const h=(i/4*31)%8000-1000,n=h+12000;dem.set([n>>8,n&255,128+(i/4)%128,255],i);}
const rows=[];
for(let run=0;run<3;run++)for(const theme of ['light','dark']){
  const a=performance.now(),before=old.convertTile({dem,width,height,theme}),oldMs=performance.now()-a;
  const b=performance.now(),after=next.convertTile({dem,width,height,theme}),newMs=performance.now()-b;
  const hashes={};for(const channel of ['land','ocean','political']){
    const expected=hash(before[channel]),actual=hash(after[channel]);if(expected!==actual)throw Error(`${theme} ${channel} pixels changed`);hashes[channel]=actual;
  }
  rows.push({run:run+1,theme,oldMs,newMs,hashes});
}
const report={schema:'canvas-theme-exact-ab-v1',base,sourceSha256:hash(current),inputSha256:hash(dem),width,height,cpu:os.cpus()[0]?.model,node:process.version,
  fixedTableBytes:428160,scope:'paired Node CPU conversion only; no Viewer, browser, screenshot or GPU timing',rows};
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(rows.map(({run,theme,oldMs,newMs})=>({run,theme,oldMs,newMs}))));
