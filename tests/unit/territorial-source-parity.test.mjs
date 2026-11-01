import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {readTerritorialSources,entityFileName,territorialSourceRoot} from '../../tools/territorial-entity-sources.mjs';
import {selectGeometryVersion} from "../../apps/editor/frontend/js/modules/territorial-library.js";
import {FOUNDER_IDS,MEMBER_HASHES,MASTER,DISPLAY} from '../../tools/gis/replay-ussr-1922-countries.mjs';
const data = new URL('../../assets/data/',import.meta.url);
const baseline = JSON.parse(fs.readFileSync(new URL('../fixtures/territorial-entity-baseline.json',import.meta.url),'utf8'));
const pinned = JSON.parse(fs.readFileSync(new URL('../fixtures/country-lineage-pinned-sources.json',import.meta.url),'utf8'));
const byteSha = value => createHash('sha256').update(value).digest('hex');
const sha = value => byteSha(JSON.stringify(value));
const lateSovietId='state:soviet-union:1922-1991-baikonur-r1-after-reviewed-day';
const documentedHistoricalGeometryCorrections=new Map([
  ['ostpreussen-1878-1920-r3',{
    legacy:'54c45d4de9f5f16e9dffb06eec24aeaef8f89b82aa455fd7c26b1064fe716237',
    geometry:'285e75670217a29020bf0dd7de323311f3cdc1e42e3efbb7c462be0ce09d2307',
  }],
]);
const modernUpdates=new Map([
  ['CHN','state:CHN:paektu-lsib-11.4'],['KOR','state:KOR:armistice-1953'],
  ['PRK','state:PRK:sino-korean-protocol-1964'],
  ...['FRA','MCO','KAB','KAZ','RUS'].map(code=>[code,'state:'+code+':natural-earth-5.1.1']),
]);
// These are additional admitted source periods, not new geometry hashes or
// claims of historical accuracy. Their complete bytes use the existing 5eb pin
// oracle below; the original 2091ee2 coordinate baseline remains unchanged.
const addedVersions=[
  ...FOUNDER_IDS.map(id=>[id,id+':1922-12-30-reviewed-v2','1922-12-30','1925-05-12','approved-ussr-1922-v2-reviewed-display']),
  ['state:soviet-union',lateSovietId+':caspian-1925-05-13','1925-05-13','1929-12-31','natural-earth-5.1.1-successor-union+baikonur-lease-mask'],
  ['state:IDN','state:IDN:1945-1963-before-west-new-guinea-r1','1945-08-17','1963-04-30','natural-earth-5.1.1-admin1-papua-island-mask'],
  ['state:IDN','state:IDN:1963-1975-before-east-timor-r1','1963-05-01','1975-12-06','natural-earth-5.1.1-post-west-new-guinea-temporal-proxy'],
  ['state:KOR','state:KOR:38th-parallel-1948','1948-08-15','1953-07-26','korean-38th-parallel'],
  ['state:PRK','state:PRK:38th-parallel-1948','1948-09-09','1953-07-26','korean-38th-parallel'],
  ['state:PRK','state:PRK:armistice-1953','1953-07-27','1964-03-19','dos-lsib-11.4'],
  ['state:RUS','state:RUS:post-soviet-existing-coordinates','1991-12-25','2006-01-11','natural-earth-5.1.1-late-soviet-adjustment'],
  ['state:RUS','state:RUS:post-soviet-existing-coordinates:rus-kaz-treaty-2006-01-12-abc-r1','2006-01-12','2014-03-17','natural-earth-5.1.1-late-soviet-adjustment'],
  ['state:KAZ','state:KAZ:post-soviet-existing-coordinates','1991-12-16','1995-09-24','natural-earth-5.1.1-late-soviet-adjustment'],
  ['state:KAZ','state:KAZ:natural-earth-5.1.1:pre-2006-treaty-r1','1995-09-25','2006-01-11','natural-earth-5.1.1+baikonur-treaty-osm-remade-1km-20261023'],
  ['state:yugoslavia','state:serbia-montenegro:2003-2006-r1','2003-02-04','2006-06-02','natural-earth-5.1.1-historical-successor-union'],
  ['state:unmik-kosovo','state:unmik-kosovo:existing-outline-proxy','1999-06-10','2008-02-16','existing-natural-earth-outline-temporal-proxy'],
  ['state:untaet-east-timor','state:untaet-east-timor:existing-outline-proxy','1999-10-25','2002-05-19','existing-natural-earth-outline-temporal-proxy'],
  ['state:MNG','state:MNG:natural-earth-5.1.1:before-china-frontier-1922',null,'1922-12-29','natural-earth-5.1.1'],
  ['state:MNG','state:MNG:natural-earth-5.1.1:china-frontier-1922-reviewed','1922-12-30','1925-05-12','natural-earth-5.1.1'],
  ['state:IRN','state:IRN:natural-earth-5.1.1:caspian-before',null,'1921-12-31','natural-earth-5.1.1'],
  ...[['1922-01-01','1922-12-29'],['1922-12-30','1925-05-12'],['1925-05-13','1929-12-31']]
    .map(([from,to])=>['state:IRN','state:IRN:natural-earth-5.1.1:caspian-'+from,from,to,'natural-earth-5.1.1']),
  ['waterbody:aral','aral-prasolov1926-approved','1922-01-01','1929-12-31','prasolov-1926-aral-approved-20261026'],
  ['waterbody:caspian','waterbody:caspian:modern-before',null,'1921-12-31','natural-earth-5.1.1'],
  ['waterbody:caspian','caspian-near1922-approved','1922-01-01','1929-12-31','approved-caspian-completion-20261024'],
  ['waterbody:caspian','waterbody:caspian:modern-after','1930-01-01',null,'natural-earth-5.1.1'],
];
const versionKey=(entityId,versionId)=>entityId+'/'+versionId;
function assertPinnedBytes(bytes,receipt,label){
  assert.ok(receipt,'Missing pinned source receipt: '+label);
  assert.equal(bytes.length,receipt.bytes,'Pinned source byte length changed: '+label);
  assert.equal(byteSha(bytes),receipt.sha256,'Pinned source contents changed: '+label);
}
let verifiedSources;
function sources(){
  if(verifiedSources)return verifiedSources;
  const config=JSON.parse(fs.readFileSync(new URL('../../config/library-data.json',import.meta.url),'utf8'));
  assert.equal(config.repository,pinned.provenance.repository);
  assert.equal(config.revision,pinned.provenance.revision,'Source parity requires the reviewed data pin');
  const entities=readTerritorialSources();
  assert.deepEqual(entities.map(e=>e.entityId).sort(),Object.keys(pinned.countries).sort());
  for(const entity of entities){
    const bytes=fs.readFileSync(join(territorialSourceRoot,'countries',entityFileName(entity.entityId)));
    assertPinnedBytes(bytes,pinned.countries[entity.entityId],entity.entityId);
    assert.deepEqual(entity.geometryVersions,JSON.parse(bytes).geometryVersions,
      entity.entityId+': normalization must preserve complete geometry and version metadata');
  }
  verifiedSources=entities;
  return entities;
}
function legacyVersions(entities){
  const versions=entities.flatMap(entity=>entity.geometryVersions.map(version=>({entity,version})));
  return Object.entries(baseline.historicalGeometry).map(([key,expected])=>{
    const originalId=key.replace(/^historical-country:/,'state:').replace(/^historical-subunit:soviet-union:/,'state:soviet-union-');
    const currentId=originalId==='state:soviet-union:1922-1991-baikonur-r1'?lateSovietId:originalId;
    const matches=versions.filter(row=>row.version.versionId===currentId);
    assert.equal(matches.length,1,'Missing or ambiguous frozen historical version: '+key);
    return {...matches[0],key,originalId,expected};
  });
}
function assertAddedVersion(entity,version,byId){
  const contract=addedVersions.find(([entityId,versionId])=>entityId===entity.entityId&&versionId===version.versionId);
  assert.ok(contract,'Unclassified added source version: '+versionKey(entity.entityId,version.versionId));
  assert.deepEqual([version.validFrom,version.validTo,version.sourceId],contract.slice(2),version.versionId);
  const provenance=version.historicalProvenance;
  if(FOUNDER_IDS.includes(entity.entityId)&&version.versionId===entity.entityId+':1922-12-30-reviewed-v2'){
    // ZIP hashes describe retained provenance; they are not hashes of later
    // adjusted polygons and do not prove topology or historical precision.
    assert.equal(version.reviewedMasterSha256,MEMBER_HASHES[MASTER]);
    assert.match(version.displaySha256,/^[a-f0-9]{64}$/,'Adjusted display receipt missing: '+version.versionId);
    assert.equal(entity.sourceInfo.approved1922.masterSha256,MEMBER_HASHES[MASTER]);
    assert.equal(entity.sourceInfo.approved1922.displaySha256,MEMBER_HASHES[DISPLAY]);
    assert.equal(version.sourceProperties.snapshot_date,'1922-12-30');
  }
  if(provenance?.sourceEntityId&&provenance.sourceGeometryVersionId&&!provenance.rusKazTreaty2006ABC){
    const original=byId.get(provenance.sourceEntityId)?.geometryVersions.find(v=>v.versionId===provenance.sourceGeometryVersionId);
    assert.ok(original,'Missing reused source: '+version.versionId);
    assert.deepEqual(version.geometry,original.geometry,'Recorded exact coordinate reuse changed: '+version.versionId);
  }
  if(provenance?.rusKazTreaty2006ABC){
    assert.equal(provenance.rusKazTreaty2006ABC.effective,'2006-01-12');
    assert.equal(provenance.rusKazTreaty2006ABC.wholeCountryHistoricallyVerified,false);
  }
}

test('all 258 Natural Earth originals retain frozen coordinates, identity and properties; named updates retain pinned source bytes', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('countries-ne-5.1.1.geojson',data),'utf8'));
  const entities = sources();
  const imported = entities.filter(e=>e.sourceInfo.featureId);
  assert.equal(imported.length,258);
  assert.deepEqual(raw.features.map(f=>f.id).sort(),baseline.countryIds.slice().sort());
  assert.equal(imported.length,raw.features.length);
  for(const feature of raw.features) {
    const e=imported.find(item=>item.entityId===`state:${feature.id}`);
    assert.ok(e,feature.id);
    assert.equal(sha(feature.geometry),baseline.countryGeometry[feature.id],feature.id+': original Natural Earth coordinates');
    assert.deepEqual(e.sourceInfo.featureProperties,feature.properties);
    assert.equal(e.sourceInfo.featureId,feature.id);
    const current=selectGeometryVersion(e,'2026-10-06');
    assert.ok(current,feature.id+': missing current source');
    assert.equal(current.versionId,e.metadata.representativeGeometryVersionId);
    if(modernUpdates.has(feature.id)){
      assert.equal(current.versionId,modernUpdates.get(feature.id));
      assert.notEqual(sha(current.geometry),baseline.countryGeometry[feature.id],feature.id);
      if(['KOR','PRK','CHN'].includes(feature.id)){
        assert.ok(current.historicalProvenance.sourceIds.includes('dos-lsib-11.4'));
        assert.equal(sha(current.geometry),e.sourceInfo.geometrySha256);
      }else if(['RUS','KAZ'].includes(feature.id)){
        const treaty=current.historicalProvenance.rusKazTreaty2006ABC;
        assert.equal(treaty.effective,'2006-01-12');
        assert.equal(treaty.wholeCountryHistoricallyVerified,false);
        // SourceInfo retains the earlier source receipt; it is not the hash of
        // every later treaty version of this country.
        const earlier=feature.id==='KAZ'?selectGeometryVersion(e,'2006-01-11'):null;
        assert.equal(e.sourceInfo.geometrySha256,earlier?sha(earlier.geometry):baseline.countryGeometry.RUS);
        assert.notEqual(sha(current.geometry),e.sourceInfo.geometrySha256);
      }else{
        assert.equal(current.modernBoundarySupplement.status,'approved-display-candidate');
        assert.equal(sha(current.geometry),e.sourceInfo.geometrySha256);
      }
    }else{
      assert.equal(sha(current.geometry),baseline.countryGeometry[feature.id],feature.id);
      assert.deepEqual(current.geometry,feature.geometry,feature.id);
    }
    assert.doesNotMatch(e.metadata.defaultFlagDataUrl || '',/^file:/);
  }
});

test('all 29 frozen historical geometries remain comparable, including 26 original migrated versions and the USSR winding-only repair', () => {
  const entities=sources(),migrated=entities.filter(e=>e.sourceInfo.importProvenance);
  assert.equal(migrated.length,23);
  const originals=legacyVersions(entities);
  assert.equal(originals.length,29);
  assert.equal(originals.filter(({entity})=>entity.sourceInfo.importProvenance).length,26);
  for(const {entity,version,key,originalId,expected} of originals){
    const provenance=entity.sourceInfo.importProvenance||version.historicalProvenance?.sourceInfo?.importProvenance;
    assert.equal(provenance?.baseSha,baseline.baseSha,key);
    assert.equal(provenance.versionIds[originalId],key);
    if(version.versionId===lateSovietId){
      assert.equal(version.geometry.type,'MultiPolygon');
      assert.equal(version.geometry.coordinates.length,231);
      const reconstructed={...version.geometry,coordinates:version.geometry.coordinates.map(polygon=>
        polygon.map(ring=>[ring[0],...ring.slice(1,-1).reverse(),ring.at(-1)]))};
      assert.equal(sha(reconstructed),expected,'USSR coordinates differ beyond the reviewed winding fix');
      assert.notEqual(sha(version.geometry),expected,'the legacy complement winding must no longer be used');
    }else{
      const correction=documentedHistoricalGeometryCorrections.get(key);
      if(correction){
        assert.equal(expected,correction.legacy,key+': documented legacy metadata changed');
        assert.equal(sha(version.geometry),correction.geometry,key);
      }else assert.equal(sha(version.geometry),expected,key);
    }
  }
  const yugo=entities.find(e=>e.entityId==='state:yugoslavia');
  const oldVersion=selectGeometryVersion(yugo,'1992-04-26');
  const newVersion=selectGeometryVersion(yugo,'1992-04-27');
  assert.equal(oldVersion.validTo,'1992-04-26');
  assert.equal(newVersion.validFrom,'1992-04-27');
  assert.notEqual(oldVersion.versionId,newVersion.versionId);
  assert.equal(selectGeometryVersion(yugo,'1943'),null);
});

test('all 315 pinned versions are classified; 28 additions retain explicit provenance, periods and recorded coordinate reuse', () => {
  const entities=sources(),byId=new Map(entities.map(entity=>[entity.entityId,entity]));
  const known=new Set(legacyVersions(entities).map(({entity,version})=>versionKey(entity.entityId,version.versionId)));
  for(const entity of entities.filter(e=>e.sourceInfo.featureId)){
    const version=selectGeometryVersion(entity,'2026-10-06');
    assert.ok(version,entity.entityId);
    known.add(versionKey(entity.entityId,version.versionId));
  }
  for(const [entityId,versionId] of addedVersions){
    const entity=byId.get(entityId),version=entity?.geometryVersions.find(row=>row.versionId===versionId);
    assert.ok(version,'Missing admitted source version: '+versionKey(entityId,versionId));
    assertAddedVersion(entity,version,byId);
    assert.ok(!known.has(versionKey(entityId,versionId)),'Added version overlaps the frozen/current classification');
    known.add(versionKey(entityId,versionId));
  }
  assert.equal(addedVersions.length,28);
  assert.equal(known.size,pinned.counts.geometryVersions);
  assert.deepEqual(entities.flatMap(entity=>entity.geometryVersions.map(version=>versionKey(entity.entityId,version.versionId))).sort(),[...known].sort());
});

test('source parity rejects modified pinned bytes and an unclassified new version', () => {
  const bytes=Buffer.from('approved source\n'),receipt={bytes:bytes.length,sha256:byteSha(bytes)};
  assertPinnedBytes(bytes,receipt,'synthetic');
  assert.throws(()=>assertPinnedBytes(Buffer.from('modified source\n'),receipt,'synthetic'),/Pinned source contents changed/);
  assert.throws(()=>assertPinnedBytes(bytes,undefined,'synthetic'),/Missing pinned source receipt/);
  assert.throws(()=>assertAddedVersion({entityId:'state:unreviewed'},{versionId:'unknown'},new Map()),/Unclassified added source version/);
});
