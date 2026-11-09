import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPhysicalSourceConfiguration} from '../../../src/data/physical-source-configuration.js';
const primary=JSON.parse(readFileSync(new URL('../../../projects/default-world/manifest.json',import.meta.url),'utf8'));
const config=(project,query='',profile='map-data',dev=null)=>createPhysicalSourceConfiguration({
 assetBaseUrl:new URL('https://example.test/assets/js/'),dataRevision:'release-abc',
 mapProject:project,resourceProfile:profile,search:query,devManifest:dev,
});

test('project terrain catalog is the authoritative source and has no cross-project fallback',()=>{
 const other={...primary,projectId:'alternate-world',resources:{...primary.resources,
  terrain:{catalog:'assets/data/terrain-preview/alternate/manifest.json'}}};
 const a=config(primary),b=config(other,'?demTerrain=preview');
 assert.equal(a.TERRAIN_PRIMARY_MANIFEST_URL.href,
   'https://example.test/assets/data/terrain-preview/v0.13.3-p2/manifest.json?v=release-abc');
 assert.equal(b.TERRAIN_PRIMARY_MANIFEST_URL.href,
   'https://example.test/assets/data/terrain-preview/alternate/manifest.json?v=release-abc');
 for(const value of [a,b])assert.equal(value.TERRAIN_FALLBACK_MANIFEST_URL,null);
 assert.notEqual(a.TERRAIN_PRIMARY_MANIFEST_URL.href,b.TERRAIN_PRIMARY_MANIFEST_URL.href);
 assert.equal(b.TERRAIN_SOURCE_CHOICE,'raster');
});

test('only an explicit development override can use a non-project terrain manifest',()=>{
 const url='http://127.0.0.1:4174/terrain/v0.13.3/manifest.json';
 const production=config(primary,'?demTerrain=local','map-data',url);
 const override=config(primary,'?demTerrain=local','test-fixture',url);
 assert.ok(production.TERRAIN_PRIMARY_MANIFEST_URL.href.includes('/assets/data/terrain-preview/'));
 assert.equal(override.TERRAIN_PRIMARY_MANIFEST_URL.href,url);
 assert.ok(override.TERRAIN_FALLBACK_MANIFEST_URL.href.includes('/assets/data/terrain-preview/'));
});
