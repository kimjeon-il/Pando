import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(process.env.PANDO_CLI_ROOT_TEST_ROOT||fileURLToPath(new URL('../../../',import.meta.url)));
const candidates=process.env.PANDO_CLI_ROOT_TEST_CANDIDATES;
const targets=[
 ['build-world-mesh.mjs','world/build-input.json'],
 ['build-world-country-packet.mjs','world/build-input.json'],
 ['build-world-bundle.mjs','world/build-input.json'],
 ['build-country-shared-boundaries.mjs','world/current.json'],
];
// Stop at the first real CLI data read. Native/geometry dependencies are inert
// linker fixtures, not alternate geometry implementations. No GIS data is read.
function probeCli(file,cwd){
 const entry=path.join(root,'tools/build',file);
 const input={root,entry,source:candidates?readFileSync(path.join(candidates,file),'utf8'):null};
 const script=`
 import fs from 'node:fs';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
 import {registerHooks,syncBuiltinESMExports} from 'node:module';
 const input=${JSON.stringify(input)};
 const {defaultRoot}=await import(pathToFileURL(path.join(input.root,'tools/data/library-context.mjs')));
 const entryUrl=pathToFileURL(input.entry).href,reads=[],writes=[];
 const stubs={
  '../data/library-runtime.mjs':['writeLibraryOutput','withLibraryOutputs'],
  '../../scripts/lib/frontend-layout.mjs':['buildFrontendIndex','frontendAsset'],
  './load-spherical-core.mjs':[],
  '../../src/geometry/geometry-validation.js':['validateGeometry','validateClippedGeometry'],
  '../../src/rendering/canonical-country-packet.js':['inspectCanonicalCountryPacket'],
  './canonical-country-packet-encoder.mjs':['encodeCanonicalCountryPacket'],
  '../gis/builtin-country-classification.mjs':['classifyBuiltinCountries'],
  '../gis/builtin-display-policy.mjs':['loadBuiltinDisplayPolicy'],
  '../../scripts/lib/gzip-asset-verification.mjs':['verifyGzipAssetBytes'],
  '../../src/geometry/boundary-topology.js':['buildCountrySharedBoundarySegments','serializeCountrySharedBoundarySegments'],
  '../../src/document/temporal.js':['sharedCalculationCore'],
  '../../src/rendering/country-shared-boundary-cache.js':['countryGeometrySignature'],
 };
 registerHooks({resolve(specifier,context,next){
  if(context.parentURL===entryUrl&&specifier in stubs){
   const source=stubs[specifier].map(name=>'export const '+name+'=()=>{throw Error("Unexpected computation before CLI input probe")}').join(';');
   return {url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true};
  }return next(specifier,context);
 },load(url,context,next){if(url===entryUrl&&input.source!==null)return{format:'module',source:input.source,shortCircuit:true};return next(url,context);}});
 const originalRead=fs.readFileSync;
 fs.readFileSync=(p,...args)=>{const resolved=path.resolve(p instanceof URL?fileURLToPath(p):p);
  if(resolved.split(path.sep).includes('assets')){reads.push(resolved);throw Error('CLI_INPUT_PROBE_STOP');}
  return originalRead(p,...args);
 };
 for(const name of ['writeFileSync','mkdirSync','unlinkSync','renameSync'])fs[name]=(...args)=>{writes.push([name,String(args[0])]);throw Error('Unexpected CLI mutation');};
 syncBuiltinESMExports();
 process.argv=[process.execPath,input.entry];
 try{await import(entryUrl);}catch(error){if(error.message!=='CLI_INPUT_PROBE_STOP')throw error;}
 if(reads.length===1&&writes.length===0)process.exitCode=0;
 console.log('CLI_ROOT_PROBE '+JSON.stringify({reads,writes,canonicalRoot:path.resolve(defaultRoot)}));
 `;
 return spawnSync(process.execPath,['--input-type=module','-'],{cwd,input:script,encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:''}});
}
for(const [file,input]of targets)for(const cwd of [root,path.join(root,'tools')])test(`${file} reads app-root ${input} from cwd ${path.relative(root,cwd)||'.'}`,()=>{
 const result=probeCli(file,cwd);assert.equal(result.status,0,result.stderr);
 const line=result.stdout.split('\n').find(row=>row.startsWith('CLI_ROOT_PROBE '));assert.ok(line,result.stdout);
 const probe=JSON.parse(line.slice('CLI_ROOT_PROBE '.length));
 assert.equal(probe.canonicalRoot,root);assert.deepEqual(probe.writes,[]);
 assert.deepEqual(probe.reads,[path.join(probe.canonicalRoot,'assets/data',input)]);
});
