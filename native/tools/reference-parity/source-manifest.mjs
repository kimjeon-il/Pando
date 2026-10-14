import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function source(root,path) {
  const target=resolve(root,path),rel=relative(resolve(root),target);
  assert.ok(rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..${sep}`),'source outside repository');
  // Declared text build representation, identical on LF and CRLF checkouts.
  return Buffer.from(readFileSync(target,'utf8').replace(/\r\n/g,'\n'));
}
export function createReferenceManifest(root,paths,runtime) {
  return {schemaVersion:2,sourceOwner:'repository Web modules',
    build:{esbuild:'0.25.10',target:'es2016',format:'iife',globalName:'ReferenceWeb'},
    sourceEncoding:'UTF-8 LF',
    files:[...new Set(paths)].sort().map(path=>({path,sha256:sha256(source(root,path))})),
    runtime:{path:'native/app/reference-web/runtime.js',sha256:sha256(runtime)}};
}
export function verifyReferenceManifest(root,manifest,runtime) {
  assert.equal(manifest.schemaVersion,2,'reference manifest schema');
  assert.equal(manifest.sourceEncoding,'UTF-8 LF','reference source representation');
  assert.ok(manifest.files.length>0,'reference source manifest empty');
  for(const file of manifest.files)
    assert.equal(sha256(source(root,file.path)),file.sha256,`reference source hash: ${file.path}`);
  assert.equal(sha256(runtime),manifest.runtime.sha256,'reference runtime hash');
  return {verifiedFiles:manifest.files.length,mismatches:0,runtimeSha256:manifest.runtime.sha256};
}
