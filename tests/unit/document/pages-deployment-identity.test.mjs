import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import YAML from 'yaml';
import {numericalTerrainFixture} from '../../helpers/numerical-terrain-fixture.mjs';
import {sharedSourceManifest} from '../../../tools/build/package-shared-core-assets.mjs';
import {verifyStagedPagesIdentity,verifyPagesIdentityReceipt}
  from '../../../tools/checks/verify-pages-identity.mjs';
import {MAP_PROJECT_ROLES,mapProjectResourcePath,mapProjectResourcePaths}
  from '../../../src/data/map-project-manifest.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const put=(root,path,bytes)=>{const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);};
const encoded=value=>Buffer.from(JSON.stringify(value));

function fixture(t){
  const parent=mkdtempSync(join(tmpdir(),'pando-p2-deploy-')),root=join(parent,'source'),stage=join(parent,'site');
  t.after(()=>rmSync(parent,{recursive:true,force:true}));
  mkdirSync(root);mkdirSync(stage);
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  git('init','-q');git('config','user.name','CI fixture');git('config','user.email','ci@example.invalid');
  const pin='b'.repeat(40);
  put(root,'package.json',JSON.stringify({version:'1.0.0'}));
  put(root,'config/library-data.json',JSON.stringify({repository:'example/library-data',revision:pin}));
  put(root,'config/toolchain-versions.json',JSON.stringify({emscripten:'6.0.3'}));
  put(root,'config/core-source-roots.json',JSON.stringify({schema:'pando-core-source-roots-v1',roots:['src/document/native']}));
  put(root,'src/document/native/src/document.cpp','int current_source=1;\n');
  git('add','.');git('commit','-qm','pinned source');const sourceCommit=git('rev-parse','HEAD');
  const source=sharedSourceManifest(root);
  const project=JSON.parse(readFileSync(new URL('../../../projects/default-world/manifest.json',import.meta.url)));
  project.resources.terrain.catalog='assets/data/terrain/v0.13.0/manifest.json';
  const rolePath=role=>mapProjectResourcePath(project,role);
  const data={
    [rolePath('world')]:{schema:'pandolab-world-bundle',schemaVersion:1,assets:{}},
    [rolePath('territorial')]:{schema:'pandolab-builtin-world',schemaVersion:2,
      storageLayout:'descriptor-geometries-v1',entities:[],geometryAssets:[]},
    [rolePath('rivers')]:{schema:'pandolab-water-shards-v5',version:'0.13.4',container:{url:'water.bin'},shards:[]},
    [rolePath('places')]:{shards:{}},
    [rolePath('placeLifetimes')]:{schema:'pando-place-urban-lifetimes-v1',schemaVersion:1,entries:[]},
    [rolePath('terrain')]:numericalTerrainFixture(),
    [rolePath('physicalLand')]:{schema:'pando-physical-land-v3',sourceSha256:'c'.repeat(64),
      asset:{sha256:'d'.repeat(64)}},
  };
  const prebuiltHashes={
    [rolePath('territorial')]:digest(encoded(data[rolePath('territorial')])),
    [rolePath('physicalLand')]:digest(encoded(data[rolePath('physicalLand')])),
  };
  data[rolePath('preparedMeshes')]={schema:'pandolab-prepared-polygon-meshes',
    schemaVersion:2,meshes:{},inputHashes:prebuiltHashes};
  const files=[];
  const staged=(path,bytes)=>{const value=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
    put(stage,path,value);files.push({path,bytes:value.length,sha256:digest(value)});return value;};
  const paths=mapProjectResourcePaths(project);
  for(const path of paths)staged(path,encoded(data[path]));
  const projectBytes=staged('assets/data/projects/default-world/manifest.json',encoded(project));
  const receipts=Object.fromEntries(MAP_PROJECT_ROLES.map(role=>{
    const path=rolePath(role),file=files.find(x=>x.path===path);
    return [role,{catalog:path,sha256:file.sha256,bytes:file.bytes,
      ...['rivers','lakes'].includes(role)?{version:'0.13.4'}:{},
      ...role==='preparedMeshes'?{current:true}:{} }];
  }));
  const dataRevision='data-'+digest(JSON.stringify([project.projectId,project.resources,
    paths.map(path=>[path,files.find(x=>x.path===path).sha256])])).slice(0,32);
  const buildId='1.0.0-build-'+sourceCommit.slice(0,12);
  const metadata={appVersion:'1.0.0',buildId,assetRevision:buildId,
    sourceCommit,dataCommit:pin,dataRevision,projectId:project.projectId,
    mapProject:project,
    mapProjectManifest:{url:'assets/data/projects/default-world/manifest.json',
      sha256:digest(projectBytes),compressedBytes:projectBytes.length,decodedBytes:projectBytes.length},
    projectCatalogs:receipts};
  staged('assets/js/build-meta.js','globalThis.PANDOLAB_BUILD_META = Object.freeze('+JSON.stringify(metadata)+');\n');
  const js=staged('assets/wasm/pandoeditor-core.js','export default function Core(){}\n');
  const wasm=staged('assets/wasm/pandoeditor-core.wasm',Buffer.from([0,97,115,109,1,0,0,0]));
  const wasmIdentity={schema:'pandoeditor-core-wasm',abiVersion:1,
    compiler:{name:'emscripten',version:'6.0.3'},sourceSha256:source.sourceSha256,inputs:source.inputs,
    assets:{js:{file:'pandoeditor-core.js',sha256:digest(js)},
      wasm:{file:'pandoeditor-core.wasm',sha256:digest(wasm)}}};
  staged('assets/wasm/pandoeditor-core.manifest.json',encoded(wasmIdentity));
  staged('index.html','<html></html>');
  const evidence={schema:'pando-web-pages-staging',sourceCommit,
    dataRepository:'example/library-data',dataCommit:pin,
    projectId:'default-world',frontendInputSha256:'f'.repeat(64),files};
  return {root,stage,sourceCommit,evidence,metadata,wasmIdentity,files,
    update(path,value){put(stage,path,value);
      const current=files.find(file=>file.path===path),bytes=readFileSync(join(stage,path));
      current.bytes=bytes.length;current.sha256=digest(bytes);},
  };
}

test('P2 gate proves committed source, WASM ABI/bytes and every selected data catalog',t=>{
  const f=fixture(t);
  const identity=verifyStagedPagesIdentity(f);
  assert.equal(identity.sourceCommit,f.sourceCommit);
  assert.equal(identity.dataRevision,f.metadata.dataRevision);
  assert.equal(identity.coreSourceSha256,f.wasmIdentity.sourceSha256);
  assert.equal(identity.coreAbiVersion,1);
  assert.equal(identity.verifiedPaths.filter(path=>path.startsWith('assets/wasm/')).length,3);
  assert.equal(identity.verifiedPaths.filter(path=>path.endsWith('/manifest.json')).length>=4,true);
  assert.deepEqual(verifyPagesIdentityReceipt({...f,evidence:{...f.evidence,deploymentIdentity:identity}}),identity);
  assert.throws(()=>verifyPagesIdentityReceipt(f),/P2_DEPLOY_RECEIPT/);
});
test('P2 gate rejects mixed Core binary and stale source even if final file receipt was updated',t=>{
  const f=fixture(t);
  f.update('assets/wasm/pandoeditor-core.wasm',Buffer.from([0,97,115,109,1,0,0,0,1]));
  assert.throws(()=>verifyStagedPagesIdentity(f),/P2_DEPLOY_WASM_BYTES/);
  const revised={...f.wasmIdentity,sourceSha256:'0'.repeat(64)};
  f.update('assets/wasm/pandoeditor-core.manifest.json',encoded(revised));
  assert.throws(()=>verifyStagedPagesIdentity(f),/P2_DEPLOY_WASM_SOURCE/);
});
test('P2 gate blocks a replaced project catalog even with updated Pages file hashes',t=>{
  const f=fixture(t);
  const p='assets/data/places/manifest.json';
  f.update(p,JSON.stringify({shards:{foreign:true}}));
  assert.throws(()=>verifyStagedPagesIdentity(f),/P2_DEPLOY_DATA_PIN/);
});
test('P2 gate rejects stale code commit, data pin or the approved receipt',t=>{
  const f=fixture(t),proof=verifyStagedPagesIdentity(f);
  assert.throws(()=>verifyStagedPagesIdentity({...f,expectedCommit:'0'.repeat(40)}),/P2_DEPLOY_SOURCE/);
  const wrong={...f.evidence,sourceCommit:'a'.repeat(40)};
  assert.throws(()=>verifyStagedPagesIdentity({...f,evidence:wrong}),/P2_DEPLOY_SOURCE/);
  put(f.root,'config/library-data.json',JSON.stringify({repository:'example/library-data',revision:'0'.repeat(40)}));
  assert.throws(()=>verifyPagesIdentityReceipt({...f,evidence:{...f.evidence,deploymentIdentity:proof}}),/P2_DEPLOY_DATA_PIN/);
});
test('Pages workflow gates both upload and deploy even when optional stage checks are skipped',()=>{
  const workflow=YAML.parse(readFileSync(new URL('../../../.github/workflows/web-pages.yml',import.meta.url),'utf8'));
  const build=workflow.jobs.build.steps,deploy=workflow.jobs.deploy.steps;
  const upload=build.findIndex(row=>row.uses?.startsWith('actions/upload-pages-artifact@'));
  const gate=build.findIndex(row=>row.name?.startsWith('Gate code, WASM'));
  assert.ok(gate>=0&&gate<upload);
  assert.ok(build[gate].run.includes('--expect-commit "$GITHUB_SHA"'));
  const publish=deploy.findIndex(row=>row.uses?.startsWith('actions/deploy-pages@'));
  const check=deploy.findIndex(row=>row.name?.startsWith('Confirm the approved code-WASM'));
  assert.ok(check>=0&&check<publish);
  assert.ok(deploy[check].run.includes('--receipt-only'));
  assert.ok(!build[gate].if?.includes('skip_checks'),'Data identity must never be skipped');
});
