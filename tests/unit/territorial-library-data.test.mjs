import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readTerritorialSources} from '../../tools/territorial-entity-sources.mjs';
const historicalData={entities:readTerritorialSources().filter(e=>e.sourceInfo.importProvenance)};
test('East Prussia r3 library preserves the reviewed geometry and reports its limitations', () => {
  const entity = historicalData.entities.find(item => item.entityId === 'state:east-prussia');
  const version = entity.geometryVersions[0];
  const coordinates = version.geometry.coordinates.flat(2);
  const coordinateKeys = new Set(coordinates.map(coordinate => coordinate.join(',')));
  // Hash the approved original, not the normalized read model.
  const path = new URL('../../assets/data/territorial-entities/source/countries/state-east-prussia.json', import.meta.url);
  const original = JSON.parse(readFileSync(path, 'utf8'));
  const approved = original.geometryVersions.find(row => row.versionId === 'ostpreussen-1878-1920-r3');
  assert.ok(approved, 'Missing frozen East Prussia version');
  const geometrySha256 = createHash('sha256').update(JSON.stringify(approved.geometry)).digest('hex');
  assert.equal(geometrySha256, '54c45d4de9f5f16e9dffb06eec24aeaef8f89b82aa455fd7c26b1064fe716237');
  assert.equal(original.metadata.geometrySha256, geometrySha256);
  assert.equal(entity.metadata.geometrySha256, geometrySha256);
  assert.deepEqual(version.geometry, approved.geometry,
    'Normalization must preserve exact approved coordinates and component structure');
  assert.equal(version.versionId, 'ostpreussen-1878-1920-r3');
  assert.equal(version.geometry.coordinates.length, 1);
  assert.equal(coordinates.length, 6766);
  assert.ok(coordinateKeys.has('22.76722,54.35627'));
  assert.ok(coordinateKeys.has('22.580668,55.057622'));
  assert.equal(version.certainty, 'medium');
  assert.equal(entity.metadata.approximateGeometry, true);
  assert.equal(entity.metadata.production, false);
  assert.equal(entity.metadata.validation.statisticalAreaWithinOnePercent, false);
  assert.equal(entity.metadata.validation.modernEastUnmatchedLengthM, 0);
  assert.equal(entity.metadata.validation.redistributionPermission, 'unconfirmed');
  assert.equal(entity.metadata.artifactSha256, 'f058012d42205bb02705c8017fba2e3c0e920b2a9f8a9eb21b312b9f7bfbdc0b');
});

test('Prussian province library entries carry their historical province flags', () => {
  for (const [entityId, marker] of [
    ['state:east-prussia', 'id="Oben"'],
    ['state:west-prussia', 'id="Mitte"'],
  ]) {
    const entity = historicalData.entities.find(item => item.entityId === entityId);
    const dataUrl = entity.metadata.defaultFlagDataUrl;
    assert.match(dataUrl, /^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(dataUrl.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
    assert.match(svg, /viewBox="0 0 600 400"/);
    assert.match(svg, new RegExp(marker));
  }
});

test('every static library object has a default flag', () => {
  const missing = historicalData.entities
    .filter(entity => !String(entity.metadata?.defaultFlagDataUrl || '').trim())
    .map(entity => entity.entityId);
  assert.deepEqual(missing, []);
});

test('Artsakh uses the right-originating white stepped flag motif', () => {
  const entity = historicalData.entities.find(item => item.entityId === 'state:nagorno-karabakh');
  const dataUrl = entity.metadata.defaultFlagDataUrl;
  const svg = Buffer.from(dataUrl.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
  assert.match(svg, /M36 0h-6/);
});


test('historical library maintains one dated identity and independently scoped source geometry versions',()=>{
  const sources=readTerritorialSources();
  assert.ok(sources.length>=258,'Expected canonical and historical entities');
  const ids=new Set();
  for(const e of sources){
    assert.ok(!ids.has(e.entityId),e.entityId+' duplicated');
    ids.add(e.entityId);
    assert.equal(e.schemaVersion,2);
    assert.ok(Array.isArray(e.geometryVersions)&&e.geometryVersions.length>0,e.entityId);
    assert.equal(e.entityKind,'general');
    for(const version of e.geometryVersions){
      for(const property of ['validFrom','validTo','certainty','sourceId'])
        assert.ok(Object.hasOwn(version,property),e.entityId+'/'+version.versionId+': '+property);
      assert.ok(['Polygon','MultiPolygon'].includes(version.geometry?.type),
        e.entityId+'/'+version.versionId+' missing polygon source');
    }
  }
  assert.ok(ids.has('state:deutsche-demokratische-republik'));
  assert.ok(ids.has('state:north-schleswig'));
});

test('1989 DDR and 1900 North Schleswig retain provisional dates, identity and catalog source warnings',()=>{
  const data=new Map(readTerritorialSources().map(e=>[e.entityId,e]));
  const ddr=data.get('state:deutsche-demokratische-republik');
  assert.equal(ddr.names.ko,'독일 민주공화국');
  assert.equal(ddr.lifetime.validFrom,'1949-10-07');
  assert.equal(ddr.lifetime.validTo,'1990-10-02');
  assert.equal(ddr.metadata.referenceDate,'1989-04-25');
  assert.equal(ddr.instantiation.mode,'territory-replacement');
  assert.ok(ddr.geometryVersions.some(v=>v.certainty==='medium' && v.geometry.type==='MultiPolygon'));
  const north=data.get('state:north-schleswig');
  assert.equal(north.names.ko,'북슐레스비히');
  assert.equal(north.entityKind,'general');
  assert.equal(north.instantiation.mode,'territory-replacement');
  assert.equal(north.metadata.approximateGeometry,true);
  const historical=north.geometryVersions.find(v=>v.versionId==='north-schleswig-1900-r3');
  assert.ok(historical);
  assert.equal(historical.validFrom,'1900-01-01');
  assert.equal(historical.validTo,'1900-01-01');
  assert.equal(historical.geometry.type,'MultiPolygon');
});

test('territory replacements preserve historical versions in current countries without duplicate historic identities',()=>{
  const byId=new Map(readTerritorialSources().map(e=>[e.entityId,e]));
  for(const [id,versionId,start,end] of [
    ['state:IDN','state:indonesia:1945-2002-r1','1975-12-07','1999-10-24'],
    ['state:UKR','state:ukraine:1991-2014-r1','1991-08-24','2014-03-17'],
    ['state:SDN','state:sudan:1956-2011-r1','1956-01-01','2011-07-08'],
  ]){
    const e=byId.get(id);
    assert.ok(e,'Missing historical counterpart '+id);
    const version=e.geometryVersions.find(v=>v.versionId===versionId);
    assert.ok(version,'Historical version missing: '+versionId);
    assert.deepEqual([version.validFrom,version.validTo],[start,end]);
    assert.equal(version.instantiation.mode,'territory-replacement');
  }
  for(const retired of ['state:indonesia','state:ukraine','state:sudan'])
    assert.equal(byId.has(retired),false,retired+' must not duplicate an existing political identity');
});

test('Soviet constituent republics remain flagged political entities, not administrative layers',()=>{
  const children=readTerritorialSources().filter(e=>e.parentEntityId==='state:soviet-union');
  // 1922 founders include a separately recorded Transcaucasian predecessor:
  // do not freeze the old Python assumption of exactly 15 children.
  assert.ok(children.length>=15,'Canonical Soviet republic membership is incomplete');
  const ids=new Set();
  for(const child of children){
    assert.ok(!ids.has(child.entityId),'Repeated Soviet child identity');
    ids.add(child.entityId);
    assert.equal(child.entityKind,'general');
    assert.equal(Object.hasOwn(child,'adminLevel'),false);
    if(child.entityId === 'state:soviet-union-transcaucasian-sfsr') {
      // Do not invent an unapproved historical flag for the separately dated 1922 founder.
      assert.equal(child.metadata.defaultFlagDataUrl ?? '', '');
      assert.equal(child.lifetime.validFrom, '1922-12-30');
      assert.equal(child.lifetime.validTo, '1936-12-04');
      assert.equal(child.metadata.approximateGeometry, true);
    } else {
      assert.match(child.metadata.defaultFlagDataUrl||'',/^data:image\/svg\+xml;base64,/,
        child.entityId+': established SSR flag unexpectedly missing');
    }
  }
});
