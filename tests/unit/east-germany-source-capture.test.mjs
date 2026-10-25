import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  EAST_IDS, NE_ADMIN1_URL, approvedVG25Capture, collectEastGermanSources,
  combineWallLayers, normalizedCollection, parseArguments, prepareVG25Derived,
  preserveSourceOutputs, selectEastGermanAdmin1, selectedGermanExterior,
  serializeSource, wfsUrl,
} from '../../tools/fetch-east-germany-sources.mjs';

const polygon = { type: 'Polygon',
  coordinates: [[[13, 52], [14, 52], [14, 53], [13, 52]]] };
const feature = (props = {}, id = 'sample') => ({
  type: 'Feature', id, properties: props, geometry: structuredClone(polygon),
});
const collection = rows => ({ type: 'FeatureCollection', features: rows });
const fullSources = () => ({
  [NE_ADMIN1_URL]: collection([
    feature({ iso_3166_2: 'FR-01' }),
    ...[...EAST_IDS].reverse().map(code => feature({iso_3166_2: code})),
  ]),
  [wfsUrl('https://sgx.geodatenzentrum.de/wfs_vg250',
    'vg250:vg250_gem', 'EPSG:25832', "ags='03355049'")]:
    collection([feature({ags:'03355049'})]),
  [wfsUrl('https://sgx.geodatenzentrum.de/wfs_vg250',
    'vg250:vg250_lan', 'EPSG:25833', "ags='11'")]:
    collection([feature({ags:'11'})]),
  [wfsUrl('https://gdi.berlin.de/services/wfs/berlinermauer',
    'berlinermauer:a_grenzmauer', 'EPSG:25833')]:
    collection([feature({class:'wall'})]),
  [wfsUrl('https://gdi.berlin.de/services/wfs/berlinermauer',
    'berlinermauer:c_politischegrenze', 'EPSG:25833')]:
    collection([feature({class:'political'})]),
});
const offlineFetcher = values => async url => {
  assert.ok(Object.hasOwn(values, url), 'Unexpected WFS/API '+url);
  return { ok: true, headers: { get: () => null },
    arrayBuffer: async () => Buffer.from(JSON.stringify(values[url])) };
};
test('Natural Earth subset is exactly six German states, sorted by canonical ISO codes', () => {
  const source = fullSources()[NE_ADMIN1_URL], before = structuredClone(source);
  const selected = selectEastGermanAdmin1(source);
  assert.equal(selected.features.length, 6);
  assert.deepEqual(selected.features.map(x=>x.properties.iso_3166_2), EAST_IDS);
  assert.deepEqual(source, before);
  const repeated = structuredClone(source); repeated.features.push(repeated.features.at(-1));
  assert.throws(() => selectEastGermanAdmin1(repeated), /duplicate/);
});
test('WFS requests preserve historical observation CRS and BKG AGS-specific filters', () => {
  const url = new URL(wfsUrl('https://host.test/wfs',
    'vg250:vg250_gem', 'EPSG:25832', "ags='03355049'"));
  assert.equal(url.searchParams.get('TYPENAMES'), 'vg250:vg250_gem');
  assert.equal(url.searchParams.get('SRSNAME'), 'EPSG:25832');
  assert.equal(url.searchParams.get('CQL_FILTER'), "ags='03355049'");
  assert.equal(url.searchParams.get('VERSION'), '2.0.0');
});
test('normalized geometry preserves inputs and Berlin layer ordering', () => {
  const raw = collection([feature({name:'original'})]);
  const result = normalizedCollection(raw,{sourceCrs:'EPSG:25833',sourceLayer:'a_grenzmauer'});
  assert.equal(result.features[0].properties.source_layer, 'a_grenzmauer');
  assert.equal(result.crs.properties.name, 'EPSG:25833');
  assert.equal(raw.features[0].properties.source_layer, undefined);
  const wall = combineWallLayers({ a_grenzmauer:raw, c_politischegrenze:raw });
  assert.deepEqual(wall.features.map(x=>x.properties.source_layer),
    ['a_grenzmauer','c_politischegrenze']);
  assert.throws(()=>combineWallLayers({a_grenzmauer:collection([]),
    c_politischegrenze:raw}), /Empty Berlin Wall/);
});
test('full capture reuses five pinned endpoints but creates only four scoped output candidates', async () => {
  const data = await collectEastGermanSources({ fetcher:offlineFetcher(fullSources()) });
  assert.deepEqual([...data.keys()],[
    'natural-earth-admin1-germany-v5.1.1.geojson',
    'bkg-vg250-amt-neuhaus-25832.geojson',
    'bkg-vg250-berlin-land-25833.geojson',
    'berlin-wall-1989-25833.geojson',
  ]);
  assert.equal(data.get('natural-earth-admin1-germany-v5.1.1.geojson').features.length, 6);
  assert.equal(data.get('berlin-wall-1989-25833.geojson').features.length, 2);
  assert.equal(data.get('bkg-vg250-amt-neuhaus-25832.geojson').features.length, 1);
  assert.ok(serializeSource(data.get('berlin-wall-1989-25833.geojson'))
    .includes('"source_layer":"a_grenzmauer"'));
});
test('capture never upgrades 2026 BKG geometry to validated 1989 historical territory', () => {
  const captured = collection(['12','13','14','15','16'].map(ags => feature({ags})));
  approvedVG25Capture(captured);
  assert.throws(()=>approvedVG25Capture(collection([feature({ags:'12'})])),/five eastern lands/);
  const german={entityId:'state:germany',geometryVersions:[{
    versionId:'modern',validTo:null,sourceId:'natural-earth-dos-lsib-11.4',
    geometry:{type:'MultiPolygon',coordinates:[polygon.coordinates]},
    modernBoundarySupplement:{reviewed:true},
  }]};
  const world={selections:[{entityId:'state:germany',geometryVersionId:'modern'}]};
  const selected = selectedGermanExterior(german,world);
  assert.equal(selected.features[0].properties.sourceId,'natural-earth-dos-lsib-11.4');
  assert.deepEqual(selected.features[0].geometry,german.geometryVersions[0].geometry);
  const candidates=prepareVG25Derived(captured,german,world,{
    capturedAt:'2026-10-22T00:00:00.000Z'});
  const receipt=candidates.get('bkg-vg25-provenance.json');
  assert.equal(receipt.historicalAccuracyVerified,false);
  assert.equal(receipt.license,'CC BY 4.0');
  assert.deepEqual(Object.keys(receipt.files).sort(),
    ['adopted-german-lsib-exterior.geojson','bkg-vg25-eastern-lands-25832.geojson']);
  german.geometryVersions[0].sourceId='unchecked-modern';
  assert.throws(()=>selectedGermanExterior(german,world),/not approved LSIB/);
});
test('preflight rejects one changed existing source before writing any new output',t=>{
  const dir=mkdtempSync(join(tmpdir(),'east-germany-source-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const snapshot=new Map([['approved.geojson',{type:'FeatureCollection',features:[]}],
    ['new.geojson',{type:'FeatureCollection',features:[]}]]);
  const initial=preserveSourceOutputs(snapshot,dir);
  assert.equal(initial.mode,'read-only-preview');
  assert.ok(initial.outputs.every(x=>x.state==='new'));
  writeFileSync(join(dir,'approved.geojson'),'Do not overwrite an approved source');
  assert.throws(()=>preserveSourceOutputs(snapshot,dir,{execute:true}),
    /Existing approved source bytes differ/);
  assert.equal(readFileSync(join(dir,'approved.geojson'),'utf8'),
    'Do not overwrite an approved source');
  const newFile=join(dir,'new.geojson');
  assert.throws(()=>readFileSync(newFile),/ENOENT/);
  rmSync(join(dir,'approved.geojson'));
  const saved=preserveSourceOutputs(snapshot,dir,{
    execute:true,commit:work=>work(),
  });
  assert.equal(saved.mode,'save-new-only');
  assert.equal(readFileSync(newFile,'utf8'),serializeSource(snapshot.get('new.geojson')));
  const reused=preserveSourceOutputs(snapshot,dir,{
    execute:true,commit:work=>work(),
  });
  assert.ok(reused.outputs.every(x=>x.state==='unchanged'));
});
test('explicit CLI execute gate prevents accidental external archive updates',()=>{
  assert.deepEqual(parseArguments([]).mode,'full');
  assert.equal(parseArguments([]).execute,false);
  assert.deepEqual(parseArguments(['--mode','vg25-captured']).mode,'vg25-captured');
  assert.throws(()=>parseArguments(['--mode','unknown']), /Expected --mode/);
});
