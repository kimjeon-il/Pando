import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const regions=['eu','as','si','af','sa','na','ar','au','gr'];
export async function hydroSourceFixture(t){
  const root=await mkdtemp(join(tmpdir(),'hydro-verification-'));t.after(()=>rm(root,{recursive:true}));const specs=[];
  for(const code of regions){
    const fixture=code==='eu'?'fixture':'stream',bytes=Buffer.from(await readFile(`tests/fixtures/hydro-source/${fixture}.zip`));
    const original=Buffer.from('HydroRIVERS_v10_eu'),replacement=Buffer.from('HydroRIVERS_v10_'+code);
    for(let at=0;(at=bytes.indexOf(original,at))!==-1;at+=original.length)replacement.copy(bytes,at);
    await writeFile(join(root,`HydroRIVERS_v10_${code}_shp.zip`),bytes);
    const spec=JSON.parse(await readFile(`tests/fixtures/hydro-source/${fixture==='fixture'?'spec':'stream-spec'}.json`));
    spec.datasetCode=code;for(const item of spec.files)item.file=item.file.replace('_eu.','_'+code+'.');specs.push(spec);
  }
  const lines=[{fid:1,source:'101',points:[[0,0],[1,0]],bounds:[0,0,1000000,0]},
    {fid:2,source:'102',points:[[1,0],[2,0]],bounds:[1000000,0,2000000,0]},
    {fid:3,source:'103',points:[[0,1],[1,0]],bounds:[0,0,1000000,1000000]}];
  const features=lines.map(row=>({metadata:{fid:row.fid,logicalFid:row.fid+100,awId:'river:'+row.fid,name:'River '+row.fid,
    sourceId:row.source,source:'fixture',layerId:'fixture',category:'river',bounds:row.bounds,stage:0,flags:0,
    fragmentIndex:0,fragmentCount:1,width:1.25,systemId:'s'},geometry:{type:'LineString',coordinates:row.points},widths:[[1,1]]}));
  const baseline={manifest:{version:'fixture',sources:{hydroRivers:specs},stages:Array.from({length:4},(_,id)=>({id,minZoom:6+id})),
    stats:{},cache:{name:'fixture'},container:{url:'old.bin'}},features:structuredClone(features)};
  baseline.features[0].geometry.coordinates[1]=[.999,0];baseline.features[0].metadata.bounds=[0,0,999000,0];
  const staged={features:structuredClone(features)},report={changes:[{fid:1,part:0,index:-1,before:[.999,0],after:[1,0]}],
    changedFeatureIds:[1],unchangedFeatureCount:2,remaining:[]};
  const input=join(root,'baseline.json'),output=join(root,'staged.json'),receipt=join(root,'report.json');
  await writeFile(input,JSON.stringify(baseline));await writeFile(output,JSON.stringify(staged));await writeFile(receipt,JSON.stringify(report));
  return {root,baseline,staged,report,input,output,receipt};
}
