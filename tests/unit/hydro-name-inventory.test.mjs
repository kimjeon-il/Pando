import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';
import { meaningfulHydroName, renderedLengthKm, renderedAreaKm2,
  compileHydroNameInventory, runHydroNameInventory } from '../../tools/inventory-hydro-names.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const square = [[0,0],[1,0],[1,1],[0,1],[0,0]];
test('placeholder hydro titles are not approved names', () => {
  for (const value of ['', null, '미명명 수계 123', 'river-719', 'lake-15', '123', '이름 없는 강'])
    assert.equal(meaningfulHydroName(value), false, String(value));
  for (const value of ['Lake Victoria', 'River 1 tributary', '도나우강', 'Sông Sài Gòn'])
    assert.equal(meaningfulHydroName(value), true, value);
});
test('spherical rendered lengths use original geometry without modifying source vertices', () => {
  assert.ok(Math.abs(renderedLengthKm({type:'LineString',coordinates:[[0,0],[1,0]]}) - 111.195) < 0.01);
  assert.ok(Math.abs(renderedLengthKm({type:'LineString',coordinates:[[179.5,0],[-179.5,0]]}) - 111.195) < 0.01);
  const area = renderedAreaKm2({type:'Polygon',coordinates:[square]});
  assert.ok(area > 12360 && area < 12370);
  assert.equal(renderedAreaKm2({type:'Polygon',coordinates:[square, square]}), 0);
});
function fixture() {
  const core = [
    {fid:1,awId:'hydro-system:42',logicalFid:42,category:'river',
      name:'미명명 수계 42',sourceId:'101',stage:0,systemId:'42',role:'mainstem',
      bounds:[0,0,1000000,0]},
    {fid:2,awId:'lake:1',logicalFid:1,category:'lake',
      name:'Lake Victoria',sourceId:'1',stage:1,systemId:'',
      bounds:[0,0,1000000,1000000]},
  ];
  const detail = [
    {fid:1,source:'HydroRIVERS',sourceId:'101',aliases:['Alpha River'],
      tributaryNames:[],osmRelationIds:[]},
    {fid:2,source:'Natural Earth',sourceId:'1',aliases:[],tributaryNames:[],osmRelationIds:[]},
  ];
  const lakes = [{properties:{source_id:'1',name_en:'Lake Victoria',pandolab_id:'lake:1'}}];
  const neRivers = [{properties:{pandolab_id:'river:100'}}];
  const manifest = {metadata:{featureCount:2},sources:{naturalEarthNameReference:[]},stats:{count:2}};
  const decoded = {manifest, features:[
    {metadata:{...core[0],...detail[0]},geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}},
    {metadata:{...core[1],...detail[1]},geometry:{type:'Polygon',coordinates:[square]}},
  ]};
  return {core, detail, lakes, neRivers, manifest, decoded};
}
test('inventory preserves FID, logical identity, original source hash and conservative name classes', () => {
  const input = fixture(), manifestBytes = Buffer.from(JSON.stringify(input.manifest));
  const before = structuredClone(input);
  const result = compileHydroNameInventory({...input,baselineSha:'fixed',
    buildMeta:'meta',receipts:{},manifestBytes,mainManifestBytes:manifestBytes});
  assert.equal(result.items.length,2);
  const river=result.items.find(row=>row.category==='river');
  const lake=result.items.find(row=>row.category==='lake');
  assert.equal(river.classification,'placeholder_with_related_name_evidence');
  assert.equal(river.rendered_mainstem_length_km,111.195);
  assert.equal(river.source_ids_sha256,hash('101'));
  assert.equal(lake.classification,'named_display');
  assert.ok(lake.rendered_area_km2>12360);
  assert.equal(result.summary.main_manifest_equal,true);
  assert.deepEqual(input,before);
});
test('unverified detail metadata, repeated FIDs and source changes fail before reports are published', () => {
  const input=fixture(), manifestBytes=Buffer.from(JSON.stringify(input.manifest));
  const args={...input,baselineSha:'fixed',buildMeta:'meta',receipts:{},manifestBytes,
    mainManifestBytes:manifestBytes};
  input.decoded.features[0].metadata.name='not approved';
  assert.throws(()=>compileHydroNameInventory(args),/Decoded metadata mismatch/);
  input.decoded.features[0].metadata.name='미명명 수계 42';
  input.detail[1].fid=1;
  assert.throws(()=>compileHydroNameInventory(args),/Repeated or missing Hydro FIDs/);
});
test('CLI generates staged report and reproducible compressed files without overwriting original', t => {
  const dir=mkdtempSync(join(tmpdir(),'hydro-name-inventory-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const input=join(dir,'source'), out=join(dir,'report');
  mkdirSync(input);
  const f=fixture(), m=Buffer.from(JSON.stringify(f.manifest));
  const save=(name,data)=>writeFileSync(join(input,name),data);
  f.manifest.metadata.core={bytes:0,sha256:''};
  f.manifest.metadata.detail={bytes:0,sha256:''};
  const core=gzipSync(JSON.stringify({version:5,features:f.core}),{mtime:0});
  const detail=gzipSync(JSON.stringify({version:5,features:f.detail}),{mtime:0});
  f.manifest.metadata.core={bytes:core.length,sha256:hash(core)};
  f.manifest.metadata.detail={bytes:detail.length,sha256:hash(detail)};
  f.manifest.sources.naturalEarthNameReference=[
    {file:'lakes_base.geojson',sha256:''},{file:'rivers_base.geojson',sha256:''}];
  const lakeBytes=Buffer.from(JSON.stringify({features:f.lakes}));
  const riverBytes=Buffer.from(JSON.stringify({features:f.neRivers}));
  f.manifest.sources.naturalEarthNameReference[0].sha256=hash(lakeBytes);
  f.manifest.sources.naturalEarthNameReference[1].sha256=hash(riverBytes);
  f.decoded.manifest=structuredClone(f.manifest);
  save('metadata-core.json.gz',core);save('metadata-detail.json.gz',detail);
  save('lakes_base.geojson',lakeBytes);save('rivers_base.geojson',riverBytes);
  save('deployed-manifest.json',JSON.stringify(f.manifest));
  save('main-manifest.json',JSON.stringify(f.manifest));
  save('deployed-build-meta.js','meta');
  save('decoded.json',JSON.stringify(f.decoded));
  runHydroNameInventory(['--input',input,'--output',out,'--baseline-sha','fixed']);
  assert.equal(JSON.parse(readFileSync(join(out,'inventory.json'),'utf8')).length,2);
  assert.equal(JSON.parse(gunzipSync(readFileSync(join(out,'inventory.json.gz')))).length,2);
  assert.equal(JSON.parse(readFileSync(join(out,'summary.json'),'utf8')).baseline_sha,'fixed');
  assert.throws(()=>runHydroNameInventory(['--input',input,'--output',out,'--baseline-sha','fixed']),
    /Refusing to overwrite/);
  assert.equal(readFileSync(join(input,'deployed-manifest.json'),'utf8'),JSON.stringify(f.manifest));
  assert.equal(m.length>0,true);
});
