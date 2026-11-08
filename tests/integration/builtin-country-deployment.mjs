import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {buildFrontendSnapshot} from '../../scripts/lib/frontend-build.mjs';
import {builtinCountryAssets} from "../../src/data/builtin-country-files.js";
import {createBuiltinWorldLoader,selectBuiltinCountries} from "../../src/data/builtin-world-loader.js";
import {libraryConfig,libraryCheckout,decodeArchiveEntry} from '../../tools/library-data.mjs';
import {execFileSync} from 'node:child_process';

const root=process.cwd(),prefix='assets/data/builtin-world/generated/v1/';
const json=path=>JSON.parse(readFileSync(resolve(root,path)));
const index=json(prefix+'index.json'),physical=builtinCountryAssets(index);
const snapshot=await buildFrontendSnapshot({root});
const expected=[prefix+'index.json',...physical.map(row=>prefix+row.file)].sort();
const web=[...snapshot.viewerPaths].filter(path=>path.startsWith(prefix)).sort();
assert.deepEqual(web,expected);
for(const spec of physical){
 const bytes=readFileSync(resolve(root,prefix+spec.file));
 assert.equal(bytes.length,spec.compressedBytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),spec.sha256);
}
const requests=[],served=new Set(web);
const loader=createBuiltinWorldLoader({manifestUrl:'https://fixture.local/'+prefix+'index.json',manifestSpec:snapshot.buildMeta.builtinWorld,
 dataRevision:snapshot.dataRevision,cacheStorage:null,fetchFn:async url=>{
  const path=new URL(url).pathname.slice(1);assert.ok(served.has(path),'must request a deployed independent file: '+path);requests.push(path);
  return new Response(readFileSync(resolve(root,path)));
 }});
const queries=[];
for(const month of ['2026-11','1989-06','1953-06']){
 const {project}=await loader.loadProject(month);const selected=selectBuiltinCountries(index,month);
 assert.deepEqual(project.territorialEntities.map(row=>row.id),selected.map(row=>row.entityId));
 queries.push({month,countries:project.territorialEntities.length});
}
const count=requests.length;await loader.loadProject('2026-11');assert.equal(requests.length,count);
assert.ok(requests.some(path=>path.includes('/country-parts/')));assert.equal(requests.some(path=>path.includes('/transport/')),false);
let preservedArchiveEntries=null;
if(process.env.COUNTRY_PUBLICATION_PLAN){
 const publication=JSON.parse(readFileSync(process.env.COUNTRY_PUBLICATION_PLAN)),checkout=libraryCheckout(root),pin=libraryConfig(root);
 const archive=revision=>JSON.parse(execFileSync('git',['show',revision+':archive/index.json'],{cwd:checkout,maxBuffer:16*1024*1024}));
 const before=archive(publication.beforeRevision),after=archive(pin.revision),selected=new Set(publication.prefixes);
 const paths=new Set([...Object.keys(before.files),...Object.keys(after.files)]);preservedArchiveEntries=0;
 for(const path of paths)if(!selected.has(path)){assert.deepEqual(after.files[path],before.files[path],'unselected archived resource changed: '+path);preservedArchiveEntries++;}
 const oldIndex=JSON.parse(decodeArchiveEntry(checkout,before.files[prefix+'index.json'],publication.beforeRevision));
 assert.deepEqual(index.entities.map(row=>[row.entityId,row.sha256,row.compressedBytes,row.decodedBytes]),oldIndex.entities.map(row=>[row.entityId,row.sha256,row.compressedBytes,row.decodedBytes]));
}
console.log(JSON.stringify({codeCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dataCommit:libraryConfig(root).revision,
 countryCount:index.entities.length,physicalFiles:physical.length,maxPhysicalBytes:Math.max(...physical.map(row=>row.compressedBytes)),viewerClosureMatch:true,queries,
 uniqueCountryRequests:new Set(requests).size-1,transportRequests:0,preservedArchiveEntries}));
