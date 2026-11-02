import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {hydroSourceArchivesFromManifest,readHydroRegion,readHydroSources,scanHydroLakeSource,scanHydroRegionMetadata,scanHydroRiverCandidates} from '../../tools/gis/hydro-source-reader.mjs';
import {assembleHydroSystemFragments,buildHydroSelectedReaches,scoreHydroSourceMetadata} from '../../tools/gis/hydro-connectivity-native.mjs';
import {assembleHydroCanonicalChains} from '../../tools/gis/hydro-reference-guides.mjs';
import {calibrateHydroPreparedRegions,markHydroCalibrationDuplicates,prepareHydroCalibrationLakeRegions,prepareHydroCalibrationLakes,prepareHydroCalibrationRegion,prepareHydroCalibrationRiverRegions,prepareHydroCalibrationRivers,runHydroCalibration,selectHydroCalibrationReferences} from '../../tools/gis/hydro-calibration-preparation.mjs';
import {zipMembers,zipMemberChunks,zipRangeMembers,readZipRangeMember} from '../../tools/lib/geonames-zip.mjs';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';

const archive='tests/fixtures/hydro-source/fixture.zip';
const specification=JSON.parse(await readFile('tests/fixtures/hydro-source/spec.json','utf8'));
function zipFiles(files){
  const local=[],central=[];let offset=0;
  for(const [name,data] of files){const filename=Buffer.from(name),checksum=crc32(data),a=Buffer.alloc(30),b=Buffer.alloc(46);
    a.writeUInt32LE(0x04034b50,0);a.writeUInt16LE(20,4);a.writeUInt32LE(checksum,14);
    a.writeUInt32LE(data.length,18);a.writeUInt32LE(data.length,22);a.writeUInt16LE(filename.length,26);
    b.writeUInt32LE(0x02014b50,0);b.writeUInt16LE(20,4);b.writeUInt16LE(20,6);b.writeUInt32LE(checksum,16);
    b.writeUInt32LE(data.length,20);b.writeUInt32LE(data.length,24);b.writeUInt16LE(filename.length,28);b.writeUInt32LE(offset,42);
    local.push(a,filename,data);central.push(b,filename);offset+=a.length+filename.length+data.length;}
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.size,8);
  end.writeUInt16LE(files.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
async function generationFixture(root,{invalidCoordinate=false,invalidAttribute=false}={}){
  const originals=new Map();
  for(const member of await zipMembers(archive)){const chunks=[];for await(const chunk of zipMemberChunks(archive,member))chunks.push(chunk);
    originals.set(member.name,Buffer.concat(chunks));}
  const dbfName=[...originals.keys()].find(name=>name.endsWith('.dbf'));
  const fields=[['HYRIV_ID',10,0],['NEXT_DOWN',10,0],['MAIN_RIV',10,0],['ORD_STRA',3,0],['DIS_AV_CMS',12,2],['UPLAND_SKM',12,2],['ENDORHEIC',2,0]];
  const records=[[101,102,102,5,1.25,100,0],[102,0,102,6,3.5,200,1],[103,102,102,4,0,50,0]];
  const headerLength=33+32*fields.length,recordLength=1+fields.reduce((n,field)=>n+field[1],0),dbf=Buffer.alloc(headerLength+records.length*recordLength+1,0);
  dbf[0]=3;dbf.writeUInt32LE(records.length,4);dbf.writeUInt16LE(headerLength,8);dbf.writeUInt16LE(recordLength,10);
  fields.forEach(([name,width,decimals],i)=>{const at=32+i*32;dbf.write(name,at,'ascii');dbf[at+11]=78;dbf[at+16]=width;dbf[at+17]=decimals;});
  dbf[headerLength-1]=13;records.forEach((row,i)=>{let at=headerLength+i*recordLength;dbf[at++]=32;
    row.forEach((value,j)=>{const [,width,decimals]=fields[j];dbf.write(Number(value).toFixed(decimals).padStart(width,' '),at,'ascii');at+=width;});});dbf[dbf.length-1]=26;
  if(invalidAttribute)dbf[headerLength+1+10+10+10+3]=88;
  originals.set(dbfName,dbf);
  const shpName=[...originals.keys()].find(name=>name.endsWith('.shp'));
  const shxName=[...originals.keys()].find(name=>name.endsWith('.shx'));
  const lines=[[[[0,0],[invalidCoordinate?NaN:0.25,0.1],[0.5,0]],[[0.5,0],[1,0]]],[[[1,0],[2,0]]],[[[0,1],[1,0]]]];
  const headers=[],bodies=[],index=[];let offset=100;
  for(const [i,parts] of lines.entries()){
    const points=parts.flat(),body=Buffer.alloc(44+parts.length*4+points.length*16);
    body.writeInt32LE(3,0);[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),
      Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))].forEach((value,j)=>body.writeDoubleLE(value,4+j*8));
    body.writeInt32LE(parts.length,36);body.writeInt32LE(points.length,40);
    let pointOffset=0;for(const [j,part] of parts.entries()){body.writeInt32LE(pointOffset,44+j*4);pointOffset+=part.length;}
    points.forEach(([x,y],j)=>{body.writeDoubleLE(x,44+parts.length*4+j*16);body.writeDoubleLE(y,52+parts.length*4+j*16);});
    const header=Buffer.alloc(8),entry=Buffer.alloc(8);header.writeInt32BE(i+1,0);header.writeInt32BE(body.length/2,4);
    entry.writeInt32BE(offset/2,0);entry.writeInt32BE(body.length/2,4);headers.push(header);bodies.push(body);index.push(entry);offset+=8+body.length;
  }
  const shpHeader=Buffer.from(originals.get(shpName).subarray(0,100)),shxHeader=Buffer.from(shpHeader);
  shpHeader.writeInt32BE(offset/2,24);shxHeader.writeInt32BE((100+index.length*8)/2,24);
  originals.set(shpName,Buffer.concat([shpHeader,...headers.flatMap((header,i)=>[header,bodies[i]])]));
  originals.set(shxName,Buffer.concat([shxHeader,...index]));
  const files=[];
  for(const [name,data] of originals)files.push({file:name.split('/').at(-1),sha256:createHash('sha256').update(data).digest('hex')});
  const path=join(root,'generation.zip');await writeFile(path,zipFiles(originals));
  return {archive:path,specification:{datasetCode:'eu',files}};
}
async function lakeFixture(root){
  const fields=[['Hylak_id','N',8],['Lake_name','C',12],['Lake_area','N',8],['Shore_len','N',8]],records=[[7,'Lac Caf\u00e9',5,8],[8,'Tiny',.5,3],[9,'Far\u0081',3,4]];
  const headerLength=33+32*fields.length,recordLength=1+fields.reduce((n,row)=>n+row[2],0),dbf=Buffer.alloc(headerLength+records.length*recordLength+1);
  dbf[0]=3;dbf.writeUInt32LE(records.length,4);dbf.writeUInt16LE(headerLength,8);dbf.writeUInt16LE(recordLength,10);
  fields.forEach(([name,type,width],i)=>{const at=32+i*32;dbf.write(name,at,'ascii');dbf[at+11]=type.charCodeAt(0);dbf[at+16]=width;});dbf[headerLength-1]=13;
  records.forEach((row,i)=>{let at=headerLength+i*recordLength;dbf[at++]=32;row.forEach((value,j)=>{const [,type,width]=fields[j];
    const text=String(value);dbf.write(type==='C'?text.padEnd(width,' '):text.padStart(width,' '),at,'latin1');at+=width;});});dbf[dbf.length-1]=26;
  const ring=(x)=>[[x,0],[x,1],[x+1,1],[x+1,0],[x,0]],bodies=[],entries=[];let offset=100;
  for(const [i,x] of [0,1,20].entries()){const points=ring(x),body=Buffer.alloc(48+points.length*16),header=Buffer.alloc(8),entry=Buffer.alloc(8);
    body.writeInt32LE(5,0);[x,0,x+1,1].forEach((v,j)=>body.writeDoubleLE(v,4+j*8));body.writeInt32LE(1,36);body.writeInt32LE(points.length,40);
    points.forEach(([a,b],j)=>{body.writeDoubleLE(a,48+j*16);body.writeDoubleLE(b,56+j*16);});header.writeInt32BE(i+1,0);header.writeInt32BE(body.length/2,4);
    entry.writeInt32BE(offset/2,0);entry.writeInt32BE(body.length/2,4);entries.push(entry);bodies.push(header,body);offset+=8+body.length;}
  const header=Buffer.alloc(100);header.writeInt32BE(9994,0);header.writeInt32BE(offset/2,24);header.writeInt32LE(1000,28);header.writeInt32LE(5,32);
  const index=Buffer.from(header);index.writeInt32BE((100+8*entries.length)/2,24);
  const data={shp:Buffer.concat([header,...bodies]),dbf,shx:Buffer.concat([index,...entries]),prj:Buffer.from('WGS84')},files={};
  for(const [ext,bytes] of Object.entries(data)){const path=join(root,`lakes.${ext}`);await writeFile(path,bytes);
    files[ext]={path,sha256:createHash('sha256').update(bytes).digest('hex')};}
  return {files,data,ring};
}
test('lake source streams selected bounding boxes, Windows names and source rings only after metadata selection',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-lakes-'));t.after(()=>rm(root,{recursive:true}));
  const {files,data,ring}=await lakeFixture(root),batches=[],input={files,bounds:[[0,-1,3,2]],batchSize:1,onBatch:batch=>batches.push(batch)};
  const result=await scanHydroLakeSource(input);assert.deepEqual(result,{records:3,selected:1});
  assert.deepEqual(batches,[[{id:7,name:'Lac Caf\u00e9',areaKm2:5,shorelineKm:8,rings:[ring(0)]}]]);
  const {shx:unusedIndex,prj:unusedProjection,...required}=files;assert.ok(unusedIndex.path&&unusedProjection.path);
  assert.deepEqual(await scanHydroLakeSource({...input,files:required,onBatch:()=>{}}),result);
  const wrong=structuredClone(files);wrong.shp.sha256='0'.repeat(64);
  await assert.rejects(scanHydroLakeSource({...input,files:wrong,onBatch:()=>{}}),/hash/i);
  const controller=new AbortController();controller.abort();await assert.rejects(scanHydroLakeSource({...input,signal:controller.signal}),{name:'AbortError'});
  assert.deepEqual(await readFile(files.shp.path),data.shp);
});
test('verified lake source reaches native polygon and regional calibration preparation',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async t=>{
    const root=await mkdtemp(join(tmpdir(),'pando-hydro-lake-pipeline-'));t.after(()=>rm(root,{recursive:true}));
    const {files}=await lakeFixture(root),options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
      runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const result=await prepareHydroCalibrationLakeRegions({files,regions:[{id:'west',bbox:[0,-1,3,2]},
      {id:'east',bbox:[19,-1,22,2]}],width:300,height:300,batchSize:1},options);
    assert.deepEqual(result.west.map(row=>row.sourceId),[7]);assert.equal(result.west[0].name,'Lac Caf\u00e9');
    assert.deepEqual(result.east.map(row=>row.sourceId),[9]);assert.equal(result.east[0].name,'Far\ufffd');assert.equal(result.west[0].screenArea,10000);
    const wrong=structuredClone(files);wrong.dbf.sha256='0'.repeat(64);
    await assert.rejects(prepareHydroCalibrationLakeRegions({files:wrong,regions:[{id:'west',bbox:[0,-1,3,2]}]},options),/hash/i);
  });
test('generation selection reads full geometry and HydroRIVERS scoring attributes without modifying originals',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-generation-'));t.after(()=>rm(root,{recursive:true}));
  const input=await generationFixture(root),before=await readFile(input.archive);
  const result=await readHydroRegion({...input,selected:new Set([101,103]),detail:'generation'});
  assert.deepEqual(result.sourceOrder,[101,103]);
  assert.deepEqual(result.rows['101'],{region:'eu',next:102,start:[0,0],end:[1,0],
    mainRiver:102,order:5,flow:1.25,upstreamArea:100,endorheic:false,
    parts:[[[0,0],[0.25,0.1],[0.5,0]],[[0.5,0],[1,0]]]});
  assert.deepEqual(result.rows['103'].parts,[[[0,1],[1,0]]]);
  assert.equal(result.rows['103'].upstreamArea,50);assert.deepEqual(await readFile(input.archive),before);
  assert.deepEqual(await readHydroSources([{...input,selected:new Set([101,103]),detail:'generation'}]),result);
  await assert.rejects(readHydroRegion({...input,selected:new Set([101]),detail:'unknown'}),/detail/i);
  await assert.rejects(readHydroRegion({archive,specification,selected:new Set([101]),detail:'generation'}),/field/i);
});
test('generation selection rejects damaged interior coordinates and scoring attributes even with matching hashes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-generation-invalid-'));t.after(()=>rm(root,{recursive:true}));
  const coordinate=await generationFixture(root,{invalidCoordinate:true});
  await assert.rejects(readHydroRegion({...coordinate,selected:new Set([101]),detail:'generation'}),/coordinate/i);
  const attribute=await generationFixture(root,{invalidAttribute:true});
  await assert.rejects(readHydroRegion({...attribute,selected:new Set([101]),detail:'generation'}),/field.*value/i);
});
test('generation metadata streams each source record in source order with all selection attributes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-metadata-'));t.after(()=>rm(root,{recursive:true}));
  const input=await generationFixture(root),rows=[];
  const result=await scanHydroRegionMetadata({...input,onRecord:row=>rows.push(row)});
  assert.deepEqual(result,{region:'eu',records:3});
  assert.deepEqual(rows,[
    {id:101,next:102,mainRiver:102,order:5,flow:1.25,upstreamArea:100,endorheic:false,recordIndex:0},
    {id:102,next:0,mainRiver:102,order:6,flow:3.5,upstreamArea:200,endorheic:true,recordIndex:1},
    {id:103,next:102,mainRiver:102,order:4,flow:0,upstreamArea:50,endorheic:false,recordIndex:2}
  ]);
  await assert.rejects(scanHydroRegionMetadata({...input,onRecord:()=>{throw Error('stop selection');}}),/stop selection/);
  const wrong=structuredClone(input.specification);wrong.files.find(file=>file.file.endsWith('.dbf')).sha256='0'.repeat(64);
  await assert.rejects(scanHydroRegionMetadata({...input,specification:wrong,onRecord:()=>{}}),/hash/i);
});
test('calibration river scan streams matching source geometry once with verified originals',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-river-scan-'));t.after(()=>rm(root,{recursive:true}));
  const input=await generationFixture(root),batches=[],before=await readFile(input.archive);
  const result=await scanHydroRiverCandidates({...input,bounds:[[1.5,-.1,2.5,.1]],batchSize:1,onBatch:batch=>batches.push(batch)});
  assert.deepEqual(result,{region:'eu',records:3,selected:1});
  assert.deepEqual(batches,[[{id:102,next:0,mainRiver:102,order:6,flow:3.5,upstreamArea:200,endorheic:true,region:'eu',parts:[[[1,0],[2,0]]]}]]);
  assert.deepEqual(await readFile(input.archive),before);
  const wrong=structuredClone(input.specification);wrong.files.find(file=>file.file.endsWith('.shp')).sha256='0'.repeat(64);
  await assert.rejects(scanHydroRiverCandidates({...input,specification:wrong,bounds:[[0,-1,3,2]],onBatch:()=>{}}),/hash/i);
  const files={};for(const member of await zipMembers(input.archive)){const chunks=[];for await(const chunk of zipMemberChunks(input.archive,member))chunks.push(chunk);
    const bytes=Buffer.concat(chunks),ext=member.name.split('.').at(-1),path=join(root,`river.${ext}`);await writeFile(path,bytes);
    files[ext]={path,sha256:createHash('sha256').update(bytes).digest('hex')};}
  const plain=[];assert.deepEqual(await scanHydroRiverCandidates({files,specification:input.specification,bounds:[[1.5,-.1,2.5,.1]],onBatch:batch=>plain.push(...batch)}),result);
  assert.deepEqual(plain,batches.flat());
  const {shx:unusedIndex,prj:unusedProjection,...required}=files;assert.ok(unusedIndex.path&&unusedProjection.path);
  assert.deepEqual(await scanHydroRiverCandidates({files:required,specification:input.specification,bounds:[[1.5,-.1,2.5,.1]],onBatch:()=>{}}),result);
});
test('verified river source reaches regional calibration without a precomputed ID list',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async t=>{
    const root=await mkdtemp(join(tmpdir(),'pando-hydro-river-regions-'));t.after(()=>rm(root,{recursive:true}));
    const input=await generationFixture(root),options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
      runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const result=await prepareHydroCalibrationRiverRegions({archives:[input],regions:[{id:'west',riverCode:'eu',bbox:[0,-1,.75,1]},
      {id:'east',riverCode:'eu',bbox:[1.5,-1,2.5,1]}],width:300,height:200,batchSize:1},options);
    assert.deepEqual(result.west.map(row=>row.sourceId),[101]);assert.deepEqual(result.east.map(row=>row.sourceId),[102]);
    const wrong=structuredClone(input);wrong.specification.files.find(file=>file.file.endsWith('.shp')).sha256='0'.repeat(64);
    await assert.rejects(prepareHydroCalibrationRiverRegions({archives:[wrong],regions:[{id:'west',riverCode:'eu',bbox:[0,-1,.75,1]}]},options),/hash/i);
    await assert.rejects(prepareHydroCalibrationRiverRegions({archives:[input],regions:[{id:'west',riverCode:'as',bbox:[0,-1,.75,1]}]},options),/sources and regions/i);
  });
test('verified selected river and lake sources produce a complete analysis result',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY||!process.env.PANDO_HYDRO_CALIBRATION_ARTIFACT},async t=>{
    const root=await mkdtemp(join(tmpdir(),'pando-hydro-analysis-'));t.after(()=>rm(root,{recursive:true}));
    const archive=await generationFixture(root),{files}=await lakeFixture(root),region={id:'europe',label:'Fixture',riverCode:'eu',bbox:[0,-1,3,2],
      riverLayer:'rivers_europe',lakeLayer:'lakes_europe',calibrate:true};
    const line={properties:{min_zoom:6},geometry:{type:'LineString',coordinates:[[0,0],[2,0]]}},
      lake={properties:{min_zoom:6},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}};
    const selected=selectHydroCalibrationReferences({regions:[region],layers:{rivers_base:[],lakes_base:[],rivers_europe:[line],lakes_europe:[lake]}});
    const input={archives:[archive],lakeFiles:files,regions:[region],...selected,sources:{fixture:true}};
    const options={pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},
      calibration:{directory:process.env.PANDO_HYDRO_CALIBRATION_ARTIFACT}};
    const before=structuredClone(input),analysis=await runHydroCalibration(input,options),result=analysis.results;
    assert.equal(result.schemaVersion,1);assert.equal(result.regions.europe.riverCandidates,2);assert.equal(result.regions.europe.lakeCandidates,1);
    assert.equal(result.regions.europe.rivers['6.0'].targetCount,1);assert.equal(result.regions.europe.lakes['6.0'].targetCount,1);
    assert.equal(result.representativeChecks['나일강'].present,false);assert.equal(result.acceptance.representativeFeaturesPresent,false);
    assert.equal(analysis.regions[0].region.id,'europe');assert.deepEqual(result.sources,{fixture:true});assert.deepEqual(input,before);
  });
test('source metadata and native scoring stream in order across bounded batches',
  {skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async t=>{
    const root=await mkdtemp(join(tmpdir(),'pando-hydro-score-'));t.after(()=>rm(root,{recursive:true}));
    const input=await generationFixture(root),batches=[];
    const result=await scoreHydroSourceMetadata({...input,batchSize:2,onBatch:rows=>batches.push(rows)},
      {directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});
    assert.deepEqual(result,{region:'eu',records:3});assert.deepEqual(batches.map(rows=>rows.length),[2,1]);
    assert.deepEqual(batches.flat().map(row=>row.id),[101,102,103]);
    assert.equal(batches[0][0].stage,null);assert.ok(Number.isFinite(batches[0][0].score));
    assert.ok(batches.flat().every(row=>row.width>=0.55&&row.width<=2.6));
    await assert.rejects(scoreHydroSourceMetadata({...input,batchSize:0,onBatch:()=>{}},{}),/batch/i);
    const controller=new AbortController();controller.abort();
    await assert.rejects(scoreHydroSourceMetadata({...input,onBatch:()=>{}},{signal:controller.signal}),{name:'AbortError'});
  });
test('selected source reaches keep full geometry and downstream-corrected widths',
  {skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async t=>{
    const root=await mkdtemp(join(tmpdir(),'pando-hydro-selected-'));t.after(()=>rm(root,{recursive:true}));
    const input=await generationFixture(root),selected=new Set([101,102,103]);
    const result=await buildHydroSelectedReaches({...input,selected},{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});
    assert.deepEqual(result.map(row=>row.id),[101,102,103]);
    assert.deepEqual(result[0].parts,[[[0,0],[0.25,0.1],[0.5,0]],[[0.5,0],[1,0]]]);
    assert.deepEqual(result[0].originalEndpoint,[1,0]);assert.equal(result[0].endWidth,result[1].width);
    assert.equal(result[2].endWidth,result[1].width);assert.equal(result[1].endWidth,result[1].width);
    assert.equal(result[1].endorheic,true);assert.equal(result[2].stage,3);
    assert.deepEqual(selected,new Set([101,102,103]));
    await assert.rejects(buildHydroSelectedReaches({...input,selected:new Set([999])},{}),/not found/i);
  });
test('verified selected source flows into the reference-guided chain builder',
  {skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY||!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async t=>{
    const root=await mkdtemp(join(tmpdir(),'pando-hydro-source-chains-'));t.after(()=>rm(root,{recursive:true}));
    const input=await generationFixture(root),connectivity={directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY};
    const reaches=await buildHydroSelectedReaches({...input,selected:new Set([101,102,103])},connectivity);
    const references=[{id:'guide',properties:{name:'Guide'},geometry:{type:'LineString',coordinates:[[0,1],[1,0],[2,0]]}}];
    const pointScreen={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const chains=await assembleHydroCanonicalChains({reaches,references},{connectivity,pointScreen});
    assert.deepEqual(chains,[[103,102],[101]]);
    const byId=new Map(reaches.map(row=>[row.id,{...row,borderPair:null}]));
    const systems=await assembleHydroSystemFragments({chains:chains.map(chain=>chain.map(id=>byId.get(id)))},connectivity);
    assert.deepEqual(systems.map(row=>({systemId:row.systemId,mainstemIndex:row.mainstemIndex,
      fragments:row.fragments.map(fragment=>({ids:fragment.reachIds,parts:fragment.widths.length}))})),
    [{systemId:102,mainstemIndex:0,fragments:[{ids:[103,102],parts:2},{ids:[101],parts:2}]}]);
  });
test('selected HydroRIVERS archive supplies clipped calibration river features',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async t=>{
    const root=await mkdtemp(join(tmpdir(),'pando-hydro-calibration-source-'));t.after(()=>rm(root,{recursive:true}));
    const input=await generationFixture(root),selected=new Set([101,102,103]),before=await readFile(input.archive);
    const options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const rows=await prepareHydroCalibrationRivers({...input,selected,bounds:[0,-1,3,1],width:300,height:200},options);
    assert.deepEqual(rows.map(row=>row.sourceId),[101,102]);assert.equal(rows[0].sourceCoordinateCount,5);
    assert.equal(rows[1].sourceCoordinateCount,2);assert.equal(rows[1].screenLength,100);
    assert.ok(Math.abs(rows[1].lengthKm-111.32)<1e-10);
    assert.deepEqual(selected,new Set([101,102,103]));assert.deepEqual(await readFile(input.archive),before);
  });
test('selected river and lake sources reach the native calibration assignment',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY||!process.env.PANDO_HYDRO_CALIBRATION_ARTIFACT},async t=>{
    const root=await mkdtemp(join(tmpdir(),'pando-hydro-calibration-pipeline-'));t.after(()=>rm(root,{recursive:true}));
    const input=await generationFixture(root),bounds=[0,-1,3,1],point={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
      runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const rivers=await prepareHydroCalibrationRivers({...input,selected:new Set([101,102,103]),bounds,width:300,height:200},point);
    const polygon={type:'Polygon',coordinates:[[[1,0],[2,0],[2,1],[1,1],[1,0]]]};
    const lakes=await prepareHydroCalibrationLakes({bounds,width:300,height:200,
      lakes:[{id:7,name:'Test',areaKm2:5,shorelineKm:8,geometry:polygon}]},point);
    const marked=await markHydroCalibrationDuplicates({bounds,baseRiverFeatures:[],baseLakeFeatures:[],rivers,lakes},point);
    const stageKeys=['6.0','6.7','7.0','7.5'];
    const region={region:{calibrate:true},...marked,
      riverTargets:Object.fromEntries(stageKeys.map(key=>[key,{lengthKm:300,screenLength:300}])),
      riverBaselines:Object.fromEntries(stageKeys.map(key=>[key,{lengthKm:0,screenLength:0}])),
      lakeTargets:Object.fromEntries(stageKeys.map(key=>[key,{screenArea:10000,count:1}])),
      lakeBaselines:Object.fromEntries(stageKeys.map(key=>[key,{screenArea:0,count:0}]))};
    const result=await calibrateHydroPreparedRegions({regions:[region]},{directory:process.env.PANDO_HYDRO_CALIBRATION_ARTIFACT});
    assert.equal(result.river.thresholds.length,4);assert.equal(result.lake.thresholds.length,4);
    assert.deepEqual(result.regions[0].rivers.map(row=>row.sourceId),[101,102]);assert.equal(result.regions[0].lakes[0].sourceId,7);
    assert.ok(result.regions[0].rivers.every(row=>row.assignedStage===null||[6,6.7,7,7.5].includes(row.assignedStage)));
  });
test('one calibration region combines selected sources, reference layers and duplicate screening',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async t=>{
    const root=await mkdtemp(join(tmpdir(),'pando-hydro-region-'));t.after(()=>rm(root,{recursive:true}));
    const source=await generationFixture(root),bounds=[0,-1,3,1],polygon={type:'Polygon',coordinates:[[[1,0],[2,0],[2,1],[1,1],[1,0]]]};
    const input={region:{id:'fixture',label:'Fixture',bbox:bounds,calibrate:true},width:300,height:200,
      riverSource:{...source,selected:new Set([101,102,103])},lakes:[{id:7,name:'Test',areaKm2:5,shorelineKm:8,geometry:polygon}],
      riverReference:{sameLayer:true,baseFeatures:[{properties:{min_zoom:6},geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}}]},
      lakeReference:{sameLayer:false,baseFeatures:[],supplementFeatures:[{properties:{min_zoom:7},geometry:polygon}]}};
    const before=structuredClone(input),options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const result=await prepareHydroCalibrationRegion(input,options);
    assert.deepEqual(result.region,input.region);assert.equal(result.riverTargets['6.0'].count,1);
    assert.equal(result.lakeTargets['6.0'].count,0);assert.equal(result.lakeTargets['7.0'].count,1);
    assert.equal(result.lakeBaselines['7.0'].count,0);assert.deepEqual(result.rivers.map(row=>row.sourceId),[101,102]);
    assert.equal(result.lakes[0].sourceId,7);assert.deepEqual(input,before);
    const preparedLakes=await prepareHydroCalibrationLakes({lakes:input.lakes,bounds,width:300,height:200},options);
    const {lakes:unused,...rest}=input;assert.equal(unused.length,1);
    assert.deepEqual(await prepareHydroCalibrationRegion({...rest,preparedLakes},options),result);
    await assert.rejects(prepareHydroCalibrationRegion({...input,preparedLakes},options),/region inputs/i);
    const preparedRivers=await prepareHydroCalibrationRivers({...input.riverSource,bounds,width:300,height:200},options);
    const {riverSource:unusedSource,...preselected}=rest;assert.ok(unusedSource.archive);
    assert.deepEqual(await prepareHydroCalibrationRegion({...preselected,preparedLakes,preparedRivers},options),result);
  });
test('full Hydro source selection requires each region exactly once',()=>{
  const regions=['eu','as','si','af','sa','na','ar','au','gr'];
  const manifest={sources:{hydroRivers:regions.map(datasetCode=>({datasetCode,files:[]}))}};
  const archives=hydroSourceArchivesFromManifest(manifest,'somewhere');
  assert.deepEqual(archives.map(row=>row.specification.datasetCode),regions);
  manifest.sources.hydroRivers[8]=manifest.sources.hydroRivers[0];
  assert.throws(()=>hydroSourceArchivesFromManifest(manifest,'somewhere'),/specification/i);
});
test('reads only selected Hydro source endpoints and verifies every pinned archive member',async()=>{
  const rows=await readHydroRegion({archive,specification,selected:new Set([103,101])});
  assert.deepEqual(rows.rows,{'101':{region:'eu',next:102,start:[0,0],end:[1,0]},'103':{region:'eu',next:102,start:[0,1],end:[1,0]}});
  assert.deepEqual(rows.sourceOrder,[101,103]);
  assert.deepEqual(await readHydroSources([{archive,specification,selected:new Set([103,101])}]),rows);
  assert.deepEqual(await readHydroSources([{archive,specification}],{selected:new Set([103,101])}),rows);
  await assert.rejects(readHydroSources([{archive,specification}],{selected:new Set([101,999])}),/not found/i);
  await assert.rejects(readHydroSources([{archive,specification,selected:new Set([101])}],{selected:new Set([101])}),/selection/i);
  await assert.rejects(readHydroSources([{archive,specification,selected:new Set([101])},
    {archive,specification,selected:new Set([103])}]),/duplicate/i);
  const wrong=structuredClone(specification);wrong.files[2].sha256='0'.repeat(64);
  await assert.rejects(readHydroRegion({archive,specification:wrong,selected:new Set([101])}),/hash/i);
  await assert.rejects(readHydroRegion({archive,specification,selected:new Set([999])}),/not found/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(readHydroRegion({archive,specification,selected:new Set([101]),signal:controller.signal}),/abort/i);
});
test('streams selected records across compressed chunk boundaries',async()=>{
  const specification=JSON.parse(await readFile('tests/fixtures/hydro-source/stream-spec.json','utf8'));
  const result=await readHydroRegion({archive:'tests/fixtures/hydro-source/stream.zip',specification,selected:new Set([100000,101999])});
  assert.deepEqual(result.sourceOrder,[100000,101999]);
  assert.deepEqual(result.rows['100000'],{region:'eu',next:100001,start:[0,0],end:[.5,.5]});
  assert.deepEqual(result.rows['101999'],{region:'eu',next:0,start:[99,0],end:[99.5,.5]});
});
test('rejects damaged ZIP member bytes without touching the source archive',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-source-'));t.after(()=>rm(root,{recursive:true}));
  const original=await readFile(archive),copy=Buffer.from(original),member=(await zipMembers(archive)).find(row=>row.name.endsWith('.prj'));
  assert(member&&member.compressed>2);copy[member.dataAt+1]^=0x40;
  const damaged=join(root,'damaged.zip');await writeFile(damaged,copy);
  await assert.rejects(readHydroRegion({archive:damaged,specification,selected:new Set([101])}));
  assert.deepEqual(await readFile(archive),original);
});
test('reads pinned Hydro entries in ZIP64 archives and rejects a damaged directory',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-zip64-'));t.after(()=>rm(root,{recursive:true}));
  const path='tests/fixtures/hydro-source/fixture-zip64.zip',data=await readFile(path);
  const result=await readHydroRegion({archive:path,specification,selected:new Set([101,103])});
  assert.deepEqual(result.sourceOrder,[101,103]);assert.deepEqual(result.rows['101'].end,[1,0]);
  const readRange=async(start,end)=>data.subarray(start,end+1);
  const entries=await zipRangeMembers({size:data.length,readRange});
  const member=entries.find(row=>row.name.endsWith('.prj'));
  assert((await readZipRangeMember({entry:member,readRange})).length>0);
  const broken=Buffer.from(data),locator=broken.lastIndexOf(Buffer.from([0x50,0x4b,0x06,0x07]));
  assert(locator>0);broken[locator]^=1;await writeFile(join(root,'broken.zip'),broken);
  await assert.rejects(readHydroRegion({archive:join(root,'broken.zip'),specification,selected:new Set([101])}),/zip64/i);
  const oversized=Buffer.from(data),central=oversized.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  assert(central>0);let extra=central+46+oversized.readUInt16LE(central+28),extraEnd=extra+oversized.readUInt16LE(central+30);
  while(extra<extraEnd&&oversized.readUInt16LE(extra)!==1)extra+=4+oversized.readUInt16LE(extra+2);
  assert(extra<extraEnd);oversized.fill(255,extra+4,extra+12);await writeFile(join(root,'oversized.zip'),oversized);
  await assert.rejects(readHydroRegion({archive:join(root,'oversized.zip'),specification,selected:new Set([101])}),/safe range/i);
});
test('rejects nonfinite selected coordinates even when the ZIP and member hash match',async()=>{
  const specification=JSON.parse(await readFile('tests/fixtures/hydro-source/invalid-shape-spec.json','utf8'));
  await assert.rejects(readHydroRegion({archive:'tests/fixtures/hydro-source/invalid-shape.zip',specification,selected:new Set([101])}),/coordinate/i);
});
