import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {test} from 'node:test';
import {sampleNativeDemTint,renderNativeDemTint,buildNativeDemTintZip} from '../../tools/gis/terrain-dem-tint.mjs';
import {readNativeRawWebp} from '../../tools/map-image/native-resample.mjs';
import {zipMembers} from '../../tools/lib/geonames-zip.mjs';
const fixture=resolve('tests/fixtures/terrain-dem-tint');
const oracle=JSON.parse(await readFile(join(fixture,'oracle.json'),'utf8'));
test('tint ZIP metadata respects its central directory byte budget',async()=>{
  await assert.rejects(zipMembers(join(fixture,'source.zip'),{maxCentral:4}),/central directory/i);
  await assert.rejects(zipMembers(join(fixture,'source.zip'),{maxCentral:-1}),/budget/i);
});
test('native GDAL tint matches frozen Python small-island and ice pixels',async t=>{
  const root=await mkdtemp(join(tmpdir(),'dem-tint-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const request={source:join(fixture,'source.tif'),ice:join(fixture,'ice.geojson'),land:join(fixture,'land.geojson'),
    temporary:join(root,'masked.tif'),width:oracle.width,height:oracle.height};
  const result=await sampleNativeDemTint(request);
  assert.deepEqual([...result.rgb],oracle.rgb);assert.equal(result.validCells,oracle.report.validCells);
  assert.equal(result.regionalFillCells,oracle.report.regionalFillCells);
  await assert.rejects(sampleNativeDemTint(request),/exists|original/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(sampleNativeDemTint({...request,temporary:join(root,'unused.tif')},{signal:controller.signal}),{name:'AbortError'});
});

for(const name of ['terrain-dem-tint-strips','terrain-dem-tint-donors'])test(`native tint matches the frozen ${name} Python result`,async t=>{
  const directory=resolve('tests/fixtures',name);
  const expected=JSON.parse(await readFile(join(directory,'oracle.json'),'utf8'));
  const root=await mkdtemp(join(tmpdir(),'dem-tint-strips-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const result=await sampleNativeDemTint({source:join(directory,'source.tif'),ice:join(directory,'ice.geojson'),land:join(directory,'land.geojson'),
    temporary:join(root,'masked.tif'),width:expected.width,height:expected.height});
  assert.deepEqual([...result.rgb],expected.rgb);assert.equal(result.validCells,expected.report.validCells);
  assert.equal(result.regionalFillCells,expected.report.regionalFillCells);
});

test('native tint reads Unicode source and temporary paths',async t=>{
  const root=await mkdtemp(join(tmpdir(),'dem-tint-unicode-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const folder=join(root,'지도-🌍');await mkdir(folder);
  for(const name of ['source.tif','ice.geojson','land.geojson'])await copyFile(join(fixture,name),join(folder,name));
  const result=await sampleNativeDemTint({source:join(folder,'source.tif'),ice:join(folder,'ice.geojson'),land:join(folder,'land.geojson'),
    temporary:join(folder,'임시.tif'),width:oracle.width,height:oracle.height});
  assert.deepEqual([...result.rgb],oracle.rgb);
});

test('native tint keeps multipolygon land equivalent to separate polygons',async t=>{
  const root=await mkdtemp(join(tmpdir(),'dem-tint-multi-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const land=JSON.parse(await readFile(join(fixture,'land.geojson'),'utf8'));
  const polygon={type:'Feature',id:'combined',properties:{},geometry:{type:'MultiPolygon',coordinates:land.features.map(item=>item.geometry.coordinates)}};
  const landPath=join(root,'land.geojson');await writeFile(landPath,JSON.stringify({type:'FeatureCollection',features:[polygon]}));
  const result=await sampleNativeDemTint({source:join(fixture,'source.tif'),ice:join(fixture,'ice.geojson'),land:landPath,
    temporary:join(root,'masked.tif'),width:oracle.width,height:oracle.height});
  assert.deepEqual([...result.rgb],oracle.rgb);assert.equal(result.validCells,oracle.report.validCells);
});

test('native tint rendering preserves pixels and cleans only its scratch file',
  {skip:!process.env.PANDO_MAP_IMAGE_ARTIFACT},async t=>{
    const root=await mkdtemp(join(tmpdir(),'dem-tint-render-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const request={source:join(fixture,'source.tif'),ice:join(fixture,'ice.geojson'),land:join(fixture,'land.geojson'),
      temporaryRoot:root,width:oracle.width,height:oracle.height};
    const result=await renderNativeDemTint(request),decoded=await readNativeRawWebp(result.webp);
    assert.equal(result.validCells,oracle.report.validCells);assert.equal(result.regionalFillCells,oracle.report.regionalFillCells);
    const rgb=[];for(let i=0;i<decoded.data.length;i+=4){rgb.push(...decoded.data.subarray(i,i+3));assert.equal(decoded.data[i+3],255);}
    assert.deepEqual(rgb,oracle.rgb);assert.deepEqual(await readdir(root),[]);
    const invalid=join(root,'invalid.json');await writeFile(invalid,JSON.stringify({type:'FeatureCollection',features:[
      {id:'same',geometry:{type:'Polygon',coordinates:[]}},{id:'same',geometry:{type:'Polygon',coordinates:[]}}]}));
    await assert.rejects(renderNativeDemTint({...request,land:invalid}),/duplicate/i);
    assert.deepEqual(await readdir(root),['invalid.json']);
  });

test('tint ZIP processing checks CRC, preserves originals and cleans temporary files',
  {skip:!process.env.PANDO_MAP_IMAGE_ARTIFACT},async t=>{
    const root=await mkdtemp(join(tmpdir(),'dem-tint-zip-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const archive=join(root,'source.zip');await copyFile(join(fixture,'source.zip'),archive);
    const original=await readFile(archive),request={archive,ice:join(fixture,'ice.geojson'),land:join(fixture,'land.geojson'),
      temporaryRoot:root,width:oracle.width,height:oracle.height};
    const result=await buildNativeDemTintZip(request),decoded=await readNativeRawWebp(result.webp);
    const rgb=[];for(let i=0;i<decoded.data.length;i+=4)rgb.push(...decoded.data.subarray(i,i+3));
    assert.deepEqual(rgb,oracle.rgb);assert.equal(result.sourceEntry,'nested/source.tif');
    assert.equal(result.validCells,oracle.report.validCells);assert.deepEqual(await readFile(archive),original);
    assert.deepEqual(await readdir(root),['source.zip']);
    const corrupted=Buffer.from(original),[entry]=await zipMembers(archive);corrupted[entry.dataAt]^=1;await writeFile(archive,corrupted);
    await assert.rejects(buildNativeDemTintZip(request),/CRC|size/i);assert.deepEqual(await readdir(root),['source.zip']);
    const traversal=Buffer.from(original),safe=Buffer.from('nested/source.tif'),unsafe=Buffer.from('../bad/source.tif');
    assert.equal(safe.length,unsafe.length);let position=0,replaced=0;
    while((position=traversal.indexOf(safe,position))!==-1){unsafe.copy(traversal,position);position+=safe.length;replaced++;}
    assert.equal(replaced,2);await writeFile(archive,traversal);
    await assert.rejects(buildNativeDemTintZip(request),/unsafe|path/i);assert.deepEqual(await readdir(root),['source.zip']);
    const controller=new AbortController();controller.abort();
    await assert.rejects(buildNativeDemTintZip(request,{signal:controller.signal}),{name:'AbortError'});
  });
