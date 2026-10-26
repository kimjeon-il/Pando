import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import '../../shared/frontend/js/vendor/polygon-clipping.min.js';
import {normalizeTerritorialLibraryEntity} from '../../apps/editor/frontend/js/modules/territorial-library.js';
import {territorialIndexEntry} from '../../apps/editor/frontend/js/modules/territorial-index-entry.js';
import {withLibraryWrite} from '../library-data.mjs';
import {packBuiltinWorldFiles,writeBuiltinWorldPublication} from '../build-builtin-world.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const bounds=ring=>ring.reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
const inside=(a,b)=>a[0]>=b[0]&&a[1]>=b[1]&&a[2]<=b[2]&&a[3]<=b[3];

/** Extract the existing NE water hole and its existing islands; no new tracing. */
export function modernCaspianWater(land) {
  // The pinned mask retains country components. Join only components touching
  // this waterbody's region before locating the already-existing enclosed sea.
  const nearby=land.coordinates.filter(polygon=>{const b=bounds(polygon[0]);return b[0]<59&&b[2]>43&&b[1]<49&&b[3]>35;});
  const joined=globalThis.polygonClipping.union(...nearby);
  const candidates=joined.flatMap(polygon=>polygon.slice(1)).filter(ring=>{
    const b=bounds(ring);return b[0]>43&&b[0]<48&&b[2]>52&&b[2]<58&&b[1]>34&&b[1]<39&&b[3]>45&&b[3]<50;
  });
  if(candidates.length!==1)throw Error('Expected one existing NE Caspian water hole');
  const ring=candidates[0],box=bounds(ring);
  const islands=joined.filter(polygon=>inside(bounds(polygon[0]),box));
  const water=islands.length?globalThis.polygonClipping.difference([ring],...islands):[[ring]];
  if(water.length!==1)throw Error('Existing NE Caspian is not one water polygon');
  return {type:'Polygon',coordinates:water[0]};
}

export function waterObjectCatalog(entity,assets) {
  const objectRef={domain:'hydroBuiltin',id:entity.entityId};
  const geometryRef=version=>({id:entity.entityId+':'+(version.certainty==='reviewed'?'restored':'modern'),version:1});
  return {identities:[{objectRef,entityKind:'lake',name:entity.names.ko,layerId:'lakes_base',source:'Natural Earth 5.1.1 / reviewed near-1922 reconstruction'}],
    timelineRecords:{schemaVersion:3,lifetimes:[{id:'life:'+entity.entityId,objectRef,...entity.lifetime}],parentRelations:[],propertyBindings:[],
      geometryBindings:entity.geometryVersions.map(version=>({id:version.versionId,objectRef,validFrom:version.validFrom,validTo:version.validTo,geometryRef:geometryRef(version)}))},
    geometries:[{geometryRef:{id:entity.entityId+':modern',version:1},asset:assets.modernWater,land:assets.modernLand},
      {geometryRef:{id:entity.entityId+':restored',version:1},asset:assets.restoredWater,land:assets.restoredLand}]};
}

function encodedAsset(url,value) {
  const decoded=Buffer.from(JSON.stringify(value)),bytes=gzipSync(decoded,{level:9});bytes[9]=10;
  return {bytes,spec:{url,encoding:'gzip',compressedBytes:bytes.length,decodedBytes:decoded.length,sha256:sha(bytes)}};
}

/** Regenerate the one admitted water object; all other source/chunk bytes are reused. */
export async function prepareWaterObjectHistory({root,approvedManifest}) {
  const physical=path.join(root,'assets/data/physical-land/v1'),territorial=path.join(root,'assets/data/territorial-entities');
  const approved=JSON.parse(fs.readFileSync(approvedManifest)),reviewed=approved.historicalWaterbodies?.[0];
  if(reviewed?.id!=='caspian-near1922-approved'||reviewed.validFrom!=='1922-12-30'||reviewed.validTo!=='1925-05-12')throw Error('Wrong approved historical physical source');
  const read=spec=>{const bytes=fs.readFileSync(path.join(root,spec.url));if(sha(bytes)!==spec.sha256)throw Error('Approved physical input hash differs: '+spec.url);return JSON.parse(gunzipSync(bytes));};
  const land=read(approved.asset),restored=read(reviewed.water);
  if(restored.type!=='Polygon'||restored.coordinates.length!==69)throw Error('Reviewed 68 island holes are required');
  read(reviewed.land);
  const modern=modernCaspianWater(land),id='waterbody:caspian';
  const modernVersion=(versionId,validFrom,validTo)=>({versionId,validFrom,validTo,certainty:'approximate',sourceId:'natural-earth-5.1.1',geometry:modern,
    notes:'Existing NE5.1.1 display baseline outside the user-approved restoration window; not a historical survey or a 2026 observed shore.'});
  const entity=normalizeTerritorialLibraryEntity({schemaVersion:2,entityId:id,entityKind:'lake',lineageId:'caspian',names:{ko:'카스피해',en:'Caspian Sea'},alternateNames:[],
    lifetime:{validFrom:null,validTo:null},parentEntityId:'',instantiation:{mode:'independent',countryUpdates:{}},
    geometryVersions:[modernVersion(id+':modern-before',null,'1922-12-29'),
      {versionId:reviewed.id,validFrom:reviewed.validFrom,validTo:reviewed.validTo,certainty:'reviewed',sourceId:'approved-caspian-completion-20261024',geometry:restored,notes:reviewed.scope},
      modernVersion(id+':modern-after','1925-05-13',null)],
    metadata:{representativeGeometryVersionId:id+':modern-after',builtinHydroId:id,geographicRegion:'Europe/Asia'},
    sourceInfo:{sourceId:'caspian-common-object-history',title:'NE5.1.1 modern baseline and approved near-1922 Caspian display restoration',license:'Preserve original source terms',
      reconstruction:'Multi-period cartographic approximation around 1922, not an exact 1922 survey.',notCoast:'Source NOT_COAST partitions remain water limits, not coast/land/banks.',
      restoredDisplaySha256:reviewed.water.sha256,existingLandSha256:approved.asset.sha256}});
  const modernWater=encodedAsset('assets/data/physical-land/v1/caspian-modern-water.json.gz',modern);
  const manifest={schema:'pando-physical-land-v2',sourceSha256:approved.sourceSha256,asset:approved.asset,
    waterObjects:waterObjectCatalog(entity,{modernWater:modernWater.spec,modernLand:approved.asset,restoredWater:reviewed.water,restoredLand:reviewed.land})};
  const source=json(entity),stored=gzipSync(source,{level:9}),indexPath=path.join(territorial,'generated/v2/index.json'),index=JSON.parse(fs.readFileSync(indexPath));
  const entry=territorialIndexEntry(entity,{sha256:sha(stored),compressedBytes:stored.length,decodedBytes:source.length});
  index.entities=index.entities.filter(row=>row.entityId!==id).concat(entry);
  const lineage={schemaVersion:2,lineageId:'caspian',names:entity.names,entityRefs:[id],relations:[]};
  index.lineages=index.lineages.filter(row=>row.lineageId!=='caspian').concat(lineage);
  const outputs=[[path.join(physical,'caspian-modern-water.json.gz'),modernWater.bytes],[path.join(physical,'manifest.json'),json(manifest)],
    [path.join(territorial,'source/countries/waterbody-caspian.json'),source],[path.join(territorial,'source/lineages/caspian.json'),json(lineage)],
    [path.join(territorial,'generated/v2/waterbody-caspian.json.gz'),stored],[indexPath,json(index)]];
  await withLibraryWrite({root,prefixes:outputs.map(([file])=>path.relative(root,file).replaceAll('\\','/'))},()=>{
    for(const [file,bytes] of outputs)fs.writeFileSync(file,bytes);
  });
  const vertices=value=>value.coordinates.reduce((count,ring)=>count+ring.length,0);
  return {entityId:id,objectRef:{domain:'hydroBuiltin',id},validFrom:reviewed.validFrom,validTo:reviewed.validTo,
    modern:{vertices:vertices(modern),holes:modern.coordinates.length-1,sha256:modernWater.spec.sha256},
    restored:{vertices:vertices(restored),holes:restored.coordinates.length-1,sha256:reviewed.water.sha256},
    reusedAssets:[approved.asset,reviewed.land,reviewed.water].map(({url,sha256})=>({url,sha256}))};
}

/** Change only the current common target contract, without recomputing GIS. */
export function prepareCommonCountryTargets(root) {
  const directory=path.join(root,'assets/data/builtin-world/generated/v1'),index=JSON.parse(fs.readFileSync(path.join(directory,'index.json'))),files=new Map();
  const targets=rows=>rows.map(({entityId,...row})=>entityId===undefined?row:{...row,objectRef:{domain:'territorial',id:entityId}});
  for(const entry of index.entities) {
    const country=JSON.parse(gunzipSync(fs.readFileSync(path.join(directory,entry.file))));
    country.timelineRecords.schemaVersion=3;
    for(const key of ['lifetimes','geometryBindings','parentRelations','propertyBindings'])country.timelineRecords[key]=targets(country.timelineRecords[key]);
    country.sourceBindings=targets(country.sourceBindings);
    entry.coverage=targets(entry.coverage);
    const decoded=Buffer.from(JSON.stringify(country)+'\n'),bytes=gzipSync(decoded,{level:9});bytes[9]=3;
    entry.compressedBytes=bytes.length;entry.decodedBytes=decoded.length;entry.sha256=sha(bytes);
    const file='countries/'+entry.entityId.replaceAll(':','-')+'-sha256-'+entry.sha256+'.json.gz';entry.file=file;files.set(file,bytes);
  }
  index.template.timelineRecords.schemaVersion=3;
  packBuiltinWorldFiles(index,files);
  writeBuiltinWorldPublication(files,directory);
  return {countryContractFiles:index.entities.length,geometryRegeneration:false,validationScope:'No country-wide geometry/coordinate audit; shared wire-target rewrite only.',transport:index.transport};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const p=arg.indexOf('=');return [arg.slice(0,p),arg.slice(p+1)];}));
  if(!args['--approved-manifest']||!args['--report'])throw Error('--approved-manifest and --report are required');
  const root=path.resolve(args['--root']||'.');
  const water=await prepareWaterObjectHistory({root,approvedManifest:args['--approved-manifest']});
  const countries=prepareCommonCountryTargets(root);
  fs.writeFileSync(args['--report'],JSON.stringify({water,countries},null,2)+'\n');
  console.log(JSON.stringify({waterId:water.entityId,countryContractFiles:countries.countryContractFiles}));
}
