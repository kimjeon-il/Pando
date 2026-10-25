#!/usr/bin/env node
/** Official Kazakh treaty anchors: incomplete lease reference, not a legal polygon. */
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const ANCHORS=[
 ['45 42 10','63 01 05'],['45 54 40','63 01 05'],['45 58 15','62 44 40'],
 ['46 12 45','62 45 30'],['46 12 45','63 19 45'],['46 13 45','63 21 00'],
 ['46 14 40','63 19 30'],['46 18 10','63 22 10'],['46 18 10','63 29 00'],
 ['46 13 30','63 53 00'],['46 14 45','63 53 00'],['46 14 45','63 54 30'],
 ['46 13 10','63 54 30'],['46 09 00','64 17 30'],['45 47 15','64 19 00'],
 ['45 46 10','63 44 10'],['45 44 05','63 43 45'],['45 40 00','63 25 00'],
 ['45 38 30','63 26 15'],['45 37 20','63 24 40'],['45 31 00','63 24 40'],
 ['45 31 00','63 18 45'],['45 27 45','63 18 45'],['45 27 45','63 22 00'],
 ['45 26 35','63 22 00'],['45 26 35','63 14 30'],['45 27 45','63 14 30'],
 ['45 27 45','63 18 30'],['45 31 00','63 18 30'],['45 31 00','63 09 10'],
 ['45 36 00','63 13 10'],
];
export const UNRESOLVED_BANKS=[[17,18],[31,1]];
function ensure(c,m){if(!c)throw Error(m);}
export function decimalDegrees(dms){
 const s=String(dms).trim().split(/\s+/).map(Number);
 ensure(s.length===3&&s.every(Number.isInteger)&&s[0]>=0&&s[1]>=0&&s[1]<60
   &&s[2]>=0&&s[2]<60,'Invalid DMS: '+dms);
 return Number((s[0]+s[1]/60+s[2]/3600).toFixed(8));
}
export function baikonurReference(){
 ensure(ANCHORS.length===31,'Expected 31 treaty anchors');
 const coords=ANCHORS.map(([lat,lon])=>[decimalDegrees(lon),decimalDegrees(lat)]);
 const features=coords.map((coordinates,i)=>({
   type:'Feature',id:'baikonur-anchor-'+String(i+1).padStart(2,'0'),
   properties:{kind:'official-anchor',treatyPoint:i+1,latDms:ANCHORS[i][0],lonDms:ANCHORS[i][1]},
   geometry:{type:'Point',coordinates},
 }));
 let straight=0;
 for(let n=1;n<=31;n++){
   const next=n===31?1:n+1;
   if(UNRESOLVED_BANKS.some(([from,to])=>n===from&&next===to))continue;
   features.push({type:'Feature',id:'baikonur-straight-'+String(n).padStart(2,'0')+'-'+String(next).padStart(2,'0'),
     properties:{kind:'treaty-straight-segment',fromPoint:n,toPoint:next,
       source:'Kazakhstan official treaty coordinates'},
     geometry:{type:'LineString',coordinates:[coords[n-1],coords[next-1]]}});
   straight++;
 }
 ensure(straight===29,'Expected 29 straight segments');
 return {type:'FeatureCollection',
   name:'Baikonur lease plot 1 — official anchors and straight segments only',
   properties:{
     status:'research-only-INCOMPLETE-not-for-runtime-or-border-replacement',
     originalTreatyDate:'1994-12-10',
     revisionReview:'2019 Kazakhstan-ratified amendment; exclusions and plot revisions not digitized',
     sourceUrls:['https://adilet.zan.kz/rus/docs/Z1900000282',
       'https://old.adilet.zan.kz/rus/docs/U950002195_'],
     originalCoordinateDatum:'not explicitly verified',
     transformation:'DMS transcription to decimal degrees only; no datum transform',
     rightBankNotReconstructed:UNRESOLVED_BANKS.map(([fromPoint,toPoint])=>({
       fromPoint,toPoint,watercourse:'Syr Darya',
     })),
     remaining:[
       'independently derive and validate both Syr Darya right-bank reaches',
       'reconstruct treaty plot exclusions and 2018/2019 revisions',
       'pairwise Kazakhstan-Baikonur topology and historic validity check',
     ],
     openStreetMapDataUsed:false,
   },
   features,
 };
}
export function writeReference(output,{check=false}={}){
 const target=resolve(output),content=JSON.stringify(baikonurReference(),null,2)+'\n';
 if(check){
   ensure(existsSync(target),'Missing treaty-reference file');
   ensure(JSON.stringify(JSON.parse(readFileSync(target,'utf8')))===
     JSON.stringify(JSON.parse(content)),'Changed treaty-reference file');
   return {output:target,checked:true};
 }
 mkdirSync(dirname(target),{recursive:true});
 writeFileSync(target,content,{flag:'wx'});
 return {output:target,checked:false};
}
export function main(argv=process.argv.slice(2)){
 let output=null,check=false;
 for(let i=0;i<argv.length;i++){
   if(argv[i]==='--check')check=true;
   else if(argv[i]==='--output'&&argv[i+1]&&!output)output=argv[++i];
   else throw Error('Usage: --output FILE [--check]');
 }
 ensure(output,'Missing --output');
 return writeReference(output,{check});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(main()));}
 catch(error){console.error('baikonur: '+error.message);process.exitCode=1;}
}
