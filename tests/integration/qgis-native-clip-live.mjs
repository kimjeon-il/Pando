import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {runNativeBridge} from '../../tools/qgis/native-bridge.mjs';

const base=resolve('build-native/qgis/migration-current'),root=mkdtempSync(join(base,'reproject-clip-proof-'));
const config=resolve(base,'qgis-config.json'),args=['--config',config];
const before=await runNativeBridge([...args,'project']);
if(before.filename||before.layer_count!==0)throw Error('Preserve the existing QGIS project; a blank test project is required');
const line=join(root,'line.geojson'),polygon=join(root,'polygon-3857.geojson'),output=join(root,'clip.geojson');
writeFileSync(line,JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',id:'road-1',geometry:{type:'LineString',coordinates:[[-2,0],[2,0]]},properties:{name:'road',source:{sourceId:'original'}}}]}),{flag:'wx'});
writeFileSync(polygon,JSON.stringify({type:'FeatureCollection',crs:{type:'name',properties:{name:'urn:ogc:def:crs:EPSG::3857'}},features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[-111319.49079327357,-111325.1428663851],[111319.49079327357,-111325.1428663851],[111319.49079327357,111325.1428663851],[-111319.49079327357,111325.1428663851],[-111319.49079327357,-111325.1428663851]]]},properties:{name:'boundary'}}]}),{flag:'wx'});
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),lineSha=sha(line),polygonSha=sha(polygon),layers=[];
try{
  const a=await runNativeBridge([...args,'open',line]);layers.push(a.id);
  const b=await runNativeBridge([...args,'open',polygon]);layers.push(b.id);
  const input=await runNativeBridge([...args,'schema','--layer',a.id]),mask=await runNativeBridge([...args,'schema','--layer',b.id]);
  assert.equal(input.crs,'EPSG:4326');assert.equal(mask.crs,'EPSG:3857');
  const result=await runNativeBridge([...args,'clip','--layer',a.id,'--overlay',b.id,'--output',output]);
  assert.equal(result.qgis.crs,'EPSG:4326');assert.equal(result.qgis.features,1);
  const feature=JSON.parse(readFileSync(output,'utf8')).features[0];
  const coordinates=feature.geometry.type==='MultiLineString'?feature.geometry.coordinates[0]:feature.geometry.coordinates;
  assert.ok(Math.abs(coordinates[0][0]+1)<1e-9);assert.ok(Math.abs(coordinates[1][0]-1)<1e-9);
  assert.ok(Math.abs(coordinates[0][1])<1e-12&&Math.abs(coordinates[1][1])<1e-12);
  assert.equal(feature.properties.name,'road');assert.equal(feature.properties.source.sourceId,'original');
  assert.equal(sha(line),lineSha);assert.equal(sha(polygon),polygonSha);
  const outputSha=sha(output);await assert.rejects(runNativeBridge([...args,'clip','--layer',a.id,'--overlay',b.id,'--output',output]),/exists/i);
  assert.equal(sha(output),outputSha);
  console.log(JSON.stringify({coordinates,sourcePreserved:true,existingOutputPreserved:true,outputSha256:outputSha}));
}finally{for(const layer of layers.reverse())await runNativeBridge([...args,'remove-layer','--layer',layer]);}
