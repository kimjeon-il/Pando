import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:test";
import * as __dep1 from "node:assert/strict";
import * as __dep3 from "node:child_process";
import * as __dep4 from "node:readline";
import * as __dep5 from "../../../tools/gis/hydronym-normalize.mjs";
import * as __dep6 from "node:crypto";
import * as __dep7 from "node:fs";
import * as __dep8 from "node:os";
import * as __dep9 from "node:path";
import * as __dep10 from "node:zlib";
import * as __dep11 from "../../../tools/gis/inventory-hydro-names.mjs";
import * as __dep12 from "../../../tools/lib/promote-hydro-names.mjs";
import * as __dep13 from "node:url";
import * as __dep14 from "../../../tools/gis/prepare-hydro-name-replacement-bundle.mjs";

// Original feature contract: hydro-name.test.mjs
contractSuite("hydro-name", async () => {
const { test } = __dep0;
const assert = __dep1.default;
const { spawn } = __dep3;
const { createInterface } = __dep4;
const { normalizeHydronym } = __dep5;

test('normalizes suffixes, placeholders and second-pass aliases', () => {
  assert.equal(normalizeHydronym('노스아랄씨', 'lake', { '노스아랄씨': '북아랄해' }), '북아랄해');
  assert.equal(normalizeHydronym('사우스아랄씨호', 'lake', { '사우스아랄씨호': '남아랄해' }), '남아랄해');
  assert.equal(normalizeHydronym('한 강강', 'river', {}), '한강');
  assert.equal(normalizeHydronym('예시 호수', 'lake', { '예시호수': '검토 호수' }), '검토호수');
  assert.equal(normalizeHydronym('미명명   수계 4', 'river', {}), '미명명 수계 4');
  assert.equal(normalizeHydronym('  River  ', 'river', {}), 'River');
  assert.equal(normalizeHydronym('x', 'river', { x: '미명명 강\r' }), '미명명 강\r');
  assert.equal(normalizeHydronym('x', 'river', { x: '미명명 강\n' }), '미명명강\n강');
  assert.equal(normalizeHydronym('x', 'river', { x: 'X River\r' }), 'X River');
  assert.throws(() => normalizeHydronym('x', 'river', { x: 42 }), /alias must be a string/);
});

test('stream handles several requests and reports malformed input', async () => {
  const child = spawn(process.execPath, ['tools/gis/hydronym-normalize.mjs', '--stream'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const rows = [];
  const lines = createInterface({ input: child.stdout });
  const reading = (async () => { for await (const line of lines) rows.push(JSON.parse(line)); })();
  child.stdin.end(`${JSON.stringify(cases[0])}\n${JSON.stringify(cases[2])}\nnot-json\n`);
  const exit = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(await exit, 0);
  await reading;
  assert.deepEqual(rows.slice(0, 2), [{ value: cases[0].expected }, { value: cases[2].expected }]);
  assert.equal(typeof rows[2].error, 'string');
});
});

// Original feature contract: hydro-name-inventory.test.mjs
contractSuite("hydro-name-inventory", () => {
const assert = __dep1.default;
const { createHash } = __dep6;
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = __dep7;
const { tmpdir } = __dep8;
const { join } = __dep9;
const test = __dep0.default;
const { gzipSync, gunzipSync } = __dep10;
const { meaningfulHydroName, renderedLengthKm, renderedAreaKm2, compileHydroNameInventory, runHydroNameInventory } = __dep11;

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
});

// Original feature contract: hydro-name-promotion.test.mjs
contractSuite("hydro-name-promotion", () => {
const assert = __dep1.default;
const test = __dep0.default;
const { approvedSystemsFromReview, promoteCoreMetadata, promoteManifest } = __dep12;


test('only accepted review entries become stable system overrides', () => {
  const systems = approvedSystemsFromReview({ entries: [
    { systemId: '2001', status: 'accepted-candidate', recommendedNameKo: '예시강', localName: 'Example', language: 'eng', aliases: ['Old'], sources: [{ url: 'https://example.test' }] },
    { systemId: '2002', status: 'ambiguous', recommendedNameKo: '보류강' },
  ] });
  assert.deepEqual(Object.keys(systems), ['2001']);
  assert.equal(systems['2001'].nameKo, '예시강');
  assert.deepEqual(systems['2001'].sources, ['https://example.test']);
});

test('promotion renames every fragment in an approved logical river system', () => {
  const source = { version: 5, features: [
    { fid: 1, systemId: '2001', name: '미명명 수계 2001', mainstemNameKo: '미명명 수계 2001' },
    { fid: 2, systemId: '2001', name: '미명명 수계 2001', mainstemNameKo: '미명명 수계 2001' },
    { fid: 3, systemId: '2002', name: '미명명 수계 2002' },
  ] };
  const promoted = promoteCoreMetadata(source, { '2001': { nameKo: '예시강' } });
  assert.deepEqual(promoted.features.map(feature => feature.name), ['예시강', '예시강', '미명명 수계 2002']);
  assert.deepEqual(promoted.features.slice(0, 2).map(feature => feature.mainstemNameKo), ['예시강', '예시강']);
});

test('promoted manifest reuses unchanged v0.13.0 assets by relative URL', () => {
  const manifest = {
    version: '0.13.0',
    index: { url: 'index.bin.gz', sha256: 'index' },
    metadata: { core: { url: 'metadata-core.json.gz' }, detail: { url: 'metadata-detail.json.gz' } },
    shards: [{ id: 0, url: 'shards/s0.bin', sha256: 'shard' }],
    cache: { name: 'pandolab-water-v0.13.0-index' },
  };
  const promoted = promoteManifest(manifest, { bytes: 123, sha256: 'core' });
  assert.equal(promoted.version, '0.13.1');
  assert.equal(promoted.index.url, '../v0.13.0/index.bin.gz');
  assert.equal(promoted.metadata.detail.url, '../v0.13.0/metadata-detail.json.gz');
  assert.equal(promoted.shards[0].url, '../v0.13.0/shards/s0.bin');
  assert.deepEqual(promoted.metadata.core, { url: 'metadata-core.json.gz', bytes: 123, sha256: 'core' });
  assert.match(promoted.cache.name, /^pandolab-water-v0\.13\.1-/);
});

test('promotion compacts Korean compound names, including lakes and non-overridden systems', () => {
  const source = { version: 5, features: [
    { fid: 1, systemId: '1', name: '세인트 폴강', mainstemNameKo: '세인트 폴강', width: 12 },
    { fid: 2, name: '조지아 만', category: 'lake' },
    { fid: 3, name: 'Lake Example', category: 'lake' },
    { fid: 4, systemId: '4', name: '미명명 수계 4', mainstemNameKo: '미명명 수계 4' },
    { fid: 5, systemId: '5', name: '미명명 수계 5', mainstemNameKo: '미명명 수계 5' },
    { fid: 6, name: '브라마푸트라강 / 얄룽창포강' },
  ] };
  const promoted = promoteCoreMetadata(source, { '5': { nameKo: '산타 마리아강' } });
  assert.deepEqual(promoted.features.map(feature => feature.name), [
    '세인트폴강', '조지아만', 'Lake Example', '미명명 수계 4', '산타마리아강', '브라마푸트라강/얄룽창포강',
  ]);
  assert.equal(promoted.features[0].mainstemNameKo, '세인트폴강');
  assert.equal(promoted.features[4].mainstemNameKo, '산타마리아강');
  assert.equal(promoted.features[0].width, 12);
  assert.equal(source.features[0].name, '세인트 폴강');
});
});

// Original feature contract: hydro-name-repack.test.mjs
contractSuite("hydro-name-repack", () => {
const assert = __dep1.default;
const { createHash } = __dep6;
const { gzipSync, gunzipSync } = __dep10;
const { execFileSync } = __dep3;
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = __dep7;
const { tmpdir } = __dep8;
const { join } = __dep9;
const { fileURLToPath } = __dep13;
const test = __dep0.default;
const { rewriteHydroNames } = __dep14;

const hash=data=>createHash('sha256').update(data).digest('hex');
function fixture(){
  const core=[{fid:1,category:'river',awId:'hydro-system:12',systemId:'12',name:'옛강',fragmentIndex:0},
    {fid:2,category:'river',awId:'hydro-system:12',systemId:'12',name:'옛강',fragmentIndex:1},
    {fid:3,category:'lake',awId:'lake:1',name:'옛호수'}];
  const detail=[{fid:1,aliases:['old'],tributaryNames:['old'],osmRelationIds:[123],source:'OSM waterway names'},
    {fid:2,osmRelationIds:[123]},{fid:3}];
  const parts=[Buffer.from('original-index'),...([core,detail].map(features=>gzipSync(JSON.stringify({version:5,features})))),Buffer.from('original-geometry')];
  let offset=0;const specs=parts.map(part=>{const row={url:'hydro.bin',offset,bytes:part.length,sha256:hash(part)};offset+=part.length;return row;});
  const bundle=Buffer.concat(parts),manifest={version:'0.13.2',schema:'pandolab-water-shards-v5',index:specs[0],
    metadata:{core:specs[1],detail:specs[2],featureCount:3},shards:[specs[3]],
    container:{url:'hydro.bin',bytes:bundle.length,sha256:hash(bundle)},stats:{compressedBytes:bundle.length,osmWaterwayMatchCount:1},
    cache:{name:'original'},sources:{osmWaterways:{matchedSystems:1},nameEnrichment:{osmMatches:1},hydroRivers:[{datasetCode:'as',osmMatches:1}]}};
  const substitutions={'12':{previousNameKo:'옛강',nameKo:'새강',aliases:['다른이름'],tributaryNames:['지류'],hydroRiversRegion:'as',independentSources:[{url:'https://example.test/source'}]}};
  return {manifest,bundle,substitutions,sourceName:'review.json',sourceBytes:Buffer.from('source'),lakeSubstitutions:{'lake:1':{previousNameKo:'옛호수',nameKo:'새호수'}}};
}
test('replaces only reviewed metadata while keeping index and geometry bytes',()=>{
  const input=fixture(),before=structuredClone(input.manifest),result=rewriteHydroNames(input);
  const m=result.manifest,b=result.bundle,section=s=>b.subarray(s.offset,s.offset+s.bytes);
  assert.deepEqual(section(m.index),Buffer.from('original-index'));
  assert.deepEqual(section(m.shards[0]),Buffer.from('original-geometry'));
  const core=JSON.parse(gunzipSync(section(m.metadata.core))).features,detail=JSON.parse(gunzipSync(section(m.metadata.detail))).features;
  assert.deepEqual(core.map(row=>row.name),['새강','새강','새호수']);
  assert.deepEqual(detail[0].aliases,['다른이름']);assert.deepEqual(detail[0].tributaryNames,['지류']);
  assert.equal(detail[1].aliases,undefined);assert.equal(detail[0].osmRelationIds,undefined);
  assert.deepEqual(detail[1].independentSourceUrls,['https://example.test/source']);
  assert.equal(result.proof.changedCoreFragments,2);assert.equal(result.proof.runtimeDeployed,false);
  assert.equal(m.container.sha256,hash(b));assert.deepEqual(input.manifest,before);
});
test('rejects corrupted bundles and mismatched identities or sources',()=>{
  const data=fixture();assert.throws(()=>rewriteHydroNames({...data,bundle:Buffer.from('corrupt')}),/bundle.*identity/i);
  assert.throws(()=>rewriteHydroNames({...data,substitutions:{'12':{...data.substitutions['12'],previousNameKo:'잘못된강'}}}),/name mismatch/i);
  assert.throws(()=>rewriteHydroNames({...data,substitutions:{'12':{...data.substitutions['12'],independentSources:[{url:'https://openstreetmap.org/relation/1'}]}}}),/independent source/i);
  assert.throws(()=>rewriteHydroNames({...data,substitutions:{'99':data.substitutions['12']}}),/missing reviewed/i);
});
test('CLI refuses staging inside original input and refuses conflicting filenames',t=>{
  const root=mkdtempSync(join(tmpdir(),'hydro-repack-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const src=join(root,'source');mkdirSync(src);const bundle=join(src,'hydro.bin');writeFileSync(bundle,'original');
  const cli=fileURLToPath(new URL("../../../tools/gis/prepare-hydro-name-replacement-bundle.mjs",import.meta.url));
  const invoke=(output,replacements)=>execFileSync(process.execPath,[cli,'--manifest','unused','--bundle',bundle,'--replacements',replacements,'--output-dir',output],{stdio:'pipe'});
  assert.throws(()=>invoke(join(src,'output'),'review.json'));
  assert.throws(()=>invoke(join(root,'output'),'Manifest.JSON'));
  assert.equal(readFileSync(bundle,'utf8'),'original');
});
});
