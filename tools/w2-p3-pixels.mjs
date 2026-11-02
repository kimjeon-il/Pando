import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url),q=createRequire(require.resolve('@playwright/test')),p=createRequire(q.resolve('playwright'));
const {PNG}=require(dirname(p.resolve('playwright-core/package.json'))+'/lib/utilsBundle.js');
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Specify evidence directory');
const rows=[];
for(const [a,b]of [['A-cold-0-0.png','B-cold-0-0.png'],['A-cold-0-1.png','B-cold-0-1.png'],['B-cold-0-0.png','A2-cold-0-0.png'],['B-browser-regression-v3-before.png','B-browser-regression-v3-after.png'],['latest-browser-regression-before.png','latest-browser-regression-after.png']]){
 const x=PNG.sync.read(readFileSync(base+'/'+a)),y=PNG.sync.read(readFileSync(base+'/'+b));if(x.width!==y.width||x.height!==y.height)throw Error('Dimensions mismatch');let differentPixels=0,maxDelta=0,minX=x.width,minY=x.height,maxX=-1,maxY=-1;
 for(let i=0;i<x.data.length;i+=4){let different=false;for(let c=0;c<4;c++){const d=Math.abs(x.data[i+c]-y.data[i+c]);maxDelta=Math.max(maxDelta,d);different||=d>0;}if(different){differentPixels++;const px=(i/4)%x.width,py=Math.floor(i/4/x.width);minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);}}
 rows.push({a,b,width:x.width,height:x.height,differentPixels,maxDelta,bounds:differentPixels?[minX,minY,maxX,maxY]:null});
}
writeFileSync(base+'/screenshot-comparison.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows));
