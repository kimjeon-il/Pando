import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {repositoryFrontendUrl} from '../helpers/frontend-source.mjs';

const root=new URL('../../',import.meta.url);
const getJSON=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const countryData=()=>getJSON('assets/data/countries-ne-5.1.1.geojson');
const previewData=()=>{
  const version=getJSON('package.json').version;
  return JSON.parse(gunzipSync(readFileSync(new URL(
    'assets/data/countries-preview-v'+version+'.geojson.gz',root))));
};
const source=path=>readFileSync(repositoryFrontendUrl(path),'utf8');
const polygons=geo=>geo.type==='Polygon'?[geo.coordinates]:geo.coordinates;
const ringArea=ring=>ring.slice(1).reduce((sum,[x,y],i)=>{
  const [a,b]=ring[i];return sum+a*y-x*b;
},0)/2;
function inspectCanonicalCollection(collection){
  assert.equal(collection.type,'FeatureCollection');
  assert.equal(collection.features.length,258);
  const ids=new Set(),issues=[];
  for(const feature of collection.features){
    assert.ok(!ids.has(feature.id),'Duplicated country source ID '+feature.id);
    ids.add(feature.id);
    const geometry=feature.geometry;
    assert.ok(['Polygon','MultiPolygon'].includes(geometry?.type),'Invalid geometry '+feature.id);
    for(const [polygonId,polygon] of polygons(geometry).entries()){
      assert.ok(polygon.length,'Empty polygon '+feature.id);
      for(const [ringId,ring] of polygon.entries()){
        assert.ok(ring.length>=4,'Ring too short '+feature.id);
        assert.deepEqual(ring[0],ring.at(-1),'Ring not closed '+feature.id);
        assert.ok(new Set(ring.slice(0,-1).map(JSON.stringify)).size>=3,'Degenerate ring '+feature.id);
        const area=ringArea(ring);
        assert.ok(Math.abs(area)>1e-14,'Zero signed area '+feature.id);
        assert.equal(area<0,ringId===0,'Winding mismatch '+feature.id);
        for(let j=1;j<ring.length;j++)
          if(JSON.stringify(ring[j-1])===JSON.stringify(ring[j]))
            issues.push({feature:feature.id,polygonId,ringId,vertex:j});
      }
    }
  }
  assert.deepEqual(issues,[],'Borneo and canonical polygons must not duplicate consecutive positions');
}
test('all 258 current canonical countries retain closed, unique, consistently wound polygon rings',()=>{
  inspectCanonicalCollection(countryData());
});
test('generated preview keeps identical geometric validity and feature structure',()=>{
  inspectCanonicalCollection(previewData());
});
test('the approved Egyptian repair remains unmodified and excludes its old erroneous vertex',()=>{
  const egypt=countryData().features.find(f=>f.id==='EGY');
  assert.ok(egypt);
  assert.equal(createHash('sha256').update(JSON.stringify(egypt.geometry)).digest('hex'),
    '94f3310f78826e03f68019de5b0cea0b17e226fbbe9b754fe3d3d7a6c729a665');
  assert.ok(!egypt.geometry.coordinates[0][0]
    .some(pair=>pair[0]===35.429207&&pair[1]===22.97833));
});
test('Borneo IDN/MYS shared border cannot acquire a duplicate repeated microvertex',()=>{
  const target=[117.703608,4.163415];
  for(const feature of countryData().features.filter(f=>['IDN','MYS'].includes(f.id)))
    for(const polygon of polygons(feature.geometry))for(const ring of polygon)
      for(let j=1;j<ring.length;j++)
        assert.ok(!(JSON.stringify(ring[j-1])===JSON.stringify(target)
          &&JSON.stringify(ring[j])===JSON.stringify(target)),feature.id+' duplicate Borneo point');
});
test('current shared polygon normalizer and coast previews reject new geometry issues only',()=>{
  const geometry=source('assets/js/modules/polygon-geometry.js');
  assert.ok(geometry.includes('!coordinatesNear(ring[ring.length - 1], coordinate)'));
  assert.ok(geometry.includes('ring[ring.length - 1] = ring[0].slice()'));
  const preview=source('assets/js/modules/map-edit-preview-calculations.js');
  assert.ok(preview.includes('new Set(validateTerritorialGeometry(before, { clipper, affectedIds }).map(issueKey))'));
  assert.ok(preview.includes('validateTerritorialGeometry(after, { clipper, affectedIds }).filter(issue => !baseline.has(issueKey(issue)))'));
});
