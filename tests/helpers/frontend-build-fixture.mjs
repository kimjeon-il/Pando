import {numericalTerrainFixture} from './numerical-terrain-fixture.mjs';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {isolatedTestWorkspace} from './check-workspace-fixture.mjs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {join,dirname} from 'node:path';
import {UI_VIEWER_SOURCES} from '../../scripts/lib/ui-source-catalog.mjs';

export function frontendFixture(t){
 const root=isolatedTestWorkspace(t,'pando-frontend-build-');
 const put=(path,text)=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
 put('package.json',JSON.stringify({version:'1.0.0'}));
 put('projects/default-world/manifest.json',readFileSync(new URL('../../projects/default-world/manifest.json',import.meta.url)));
 for(const path of new Set([...UI_VIEWER_SOURCES,'assets/css/app.css','assets/css/viewer.css']))put(path.replace('assets/css/','src/ui/css/'),'.x { color: red; }');
 put('src/runtime/resource-dependency-policy.js',readFileSync(new URL('../../src/runtime/resource-dependency-policy.js',import.meta.url)));
 put('src/rendering/resource-update-policy.js','export const value=1;');
 put('src/app/viewer.js','export const viewer=true;');
 const html=entry=>'<html data-app-version="1.0.0"><link rel="stylesheet" href="assets/css/ui-viewer.bundle.css"><script src="assets/js/build-meta.js"></script><script type="module" src="assets/js/'+entry+'"></script></html>';
 put('src/app/index.html',html('viewer.js'));
 const physicalLand=Buffer.from(JSON.stringify({type:'MultiPolygon',coordinates:[[[[0,0],[0,1],[1,1],[1,0],[0,0]]]]}));
 const storedPhysicalLand=gzipSync(physicalLand,{level:9,mtime:0});
 const physicalAsset={url:'assets/data/physical-land/land.bin',encoding:'gzip',
   compressedBytes:storedPhysicalLand.length,decodedBytes:physicalLand.length,
   sha256:createHash('sha256').update(storedPhysicalLand).digest('hex')};
 const metadata={
  'assets/data/world/current.json':{schema:'pandolab-world-bundle',schemaVersion:1,assets:{}},
  'assets/data/terrain/v0.13.3/manifest.json':numericalTerrainFixture(),
  'assets/data/physical-land/v1/manifest.json':{schema:'pando-physical-land-v3',sourceSha256:'a'.repeat(64),asset:physicalAsset},
  'assets/data/hydro/v0.13.4/manifest.json':{schema:'pandolab-water-shards-v5',version:'0.13.4',container:{url:'data.bin'},shards:[]},
  'assets/data/places/manifest.json':{shards:{}},
  'assets/data/places/urban-lifetimes-v1.json':{schema:'pando-place-urban-lifetimes-v1',schemaVersion:1,entries:[]},
  'assets/data/territorial-entities/generated/v2/index.json':{entities:[]},
  'assets/data/builtin-world/generated/v1/index.json':{schema:'pandolab-builtin-world',schemaVersion:2,storageLayout:'descriptor-geometries-v1',geometryAssets:[],entities:[],template:{}},
  'assets/data/prepared-polygons/generated/v2/manifest.json':{schema:'pandolab-prepared-polygon-meshes',schemaVersion:2,meshes:{},inputHashes:{},algorithmSourceSha256:'mesh'},
  'assets/data/physical-land/land.bin':storedPhysicalLand,'assets/data/hydro/v0.13.4/data.bin':null,
 };
 for(const catalog of ['assets/data/builtin-world/generated/v1/index.json','assets/data/physical-land/v1/manifest.json'])
  metadata['assets/data/prepared-polygons/generated/v2/manifest.json'].inputHashes[catalog]=
   createHash('sha256').update(JSON.stringify(metadata[catalog])).digest('hex');
 return{root,put,metadata,options:{root,sourceCommit:'a'.repeat(40),dataPaths:Object.keys(metadata),readPinnedData:path=>Buffer.isBuffer(metadata[path])?metadata[path]:Buffer.from(JSON.stringify(metadata[path]))}};
}
