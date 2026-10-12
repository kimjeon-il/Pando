import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, version } from 'esbuild';
import { createReferenceManifest } from './source-manifest.mjs';

// Build tooling only: Qt executes the checked generated bundle, with the
// canonical Web modules as its inputs. No application-side source copies.
assert.equal(version,'0.25.10','reference runtime compiler version');
const root=fileURLToPath(new URL('../../../',import.meta.url));
const output='native/app/reference-web/runtime.js';
const result=await build({absWorkingDir:root,entryPoints:['native/app/reference-web/adapter.js'],
  bundle:true,target:'es2016',format:'iife',globalName:'ReferenceWeb',outfile:output,
  write:false,metafile:true,logLevel:'warning'});
const bytes=Buffer.from(result.outputFiles[0].contents);
const manifest=createReferenceManifest(root,Object.keys(result.metafile.inputs),bytes);
const runtime=new URL('../../app/reference-web/runtime.js',import.meta.url);
const manifestPath=new URL('../../app/reference-web/manifest.json',import.meta.url);
if(process.argv.includes('--check')) {
  assert.deepEqual(readFileSync(runtime),bytes,'reference bundle is stale; run build-runtime.mjs');
  assert.deepEqual(JSON.parse(readFileSync(manifestPath)),manifest,'reference source manifest is stale');
} else {
  writeFileSync(runtime,bytes);
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
}
console.log(JSON.stringify({mode:process.argv.includes('--check')?'check':'build',inputs:manifest.files.length,
  runtimeBytes:bytes.length,runtimeSha256:manifest.runtime.sha256}));
