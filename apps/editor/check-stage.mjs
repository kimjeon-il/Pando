import assert from 'node:assert/strict';
import {editorStageRoot} from '../../tools/worktree-storage.mjs';
import { createHash } from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadFullWorldAssetPlan} from './world-data-plan.mjs';

/** Verify the current product contract, independently of a historical file count. */
export async function checkShellStage(root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')){
 const directory=resolve(editorStageRoot(root),'dist');
 const evidence=JSON.parse(await readFile(resolve(directory,'shell/stage-evidence.json'),'utf8'));
 const profile=JSON.parse(await readFile(resolve(directory,'shell/stage-profile.json'),'utf8'));
 assert.equal(profile.verification, evidence.verification, 'Stage mode identity mismatch');
 const verificationFiles = ['verification.js','probe-storage.js','diagnostics.js','full-world-probe.js','fixture-limits.js','diagnostics.css'];
 for (const file of verificationFiles) assert.equal(evidence.files.some(entry => entry.path === 'shell/' + file), evidence.verification, file);
 assert.ok(evidence.files.some(file=>file.path==='index.html'));
 const metadataSource = await readFile(resolve(directory,'assets/js/build-meta.js'),'utf8');
 const metadata = JSON.parse(metadataSource.match(/Object\.freeze\(([\s\S]*?)\);/)?.[1] || '{}');
 assert.ok(Object.keys(metadata.workerAssets || {}).length, 'Missing generated Worker identities');
 for (const [entry, asset] of Object.entries(metadata.workerAssets)) {
   assert.ok(asset.files.includes(asset.url), 'Missing Worker entry: ' + entry);
   for (const path of asset.files) {
     assert.match(path, /^assets\/worker-runtime\/[a-f0-9]{32}\/assets\//);
     const source = (await readFile(resolve(directory,path),'utf8')).replaceAll('\r\n','\n');
     assert.equal(createHash('sha256').update(source).digest('hex'), asset.sha256[path], path);
   }
 }
 assert.ok(evidence.files.some(file=>file.path===metadata.physicalLand.url), 'Physical substrate must be bundled in both profiles');
 const html=await readFile(resolve(directory,'index.html'),'utf8');
 assert.match(html,/assets\/js\/bootstrap\.js/);assert.doesNotMatch(html,/<script\b[^>]*src=["'][^"']*assets\/js\/viewer\.js/);
 if(profile.mode==='map-data'){
   const {plan}=await loadFullWorldAssetPlan(path=>path==='assets/js/build-meta.js'?Promise.resolve(metadataSource):readFile(resolve(root,path),'utf8'));
   for(const key of ['worldFileCount','physicalFileCount','countryCount','rootCount','unitCount','modelEntityCount','mergedSourceCount','sourceSha256'])assert.equal(evidence.worldData[key],plan[key],key);
   assert.equal(evidence.worldData.fileCount,plan.entries.length);
   const staged=new Set(evidence.files.map(file=>file.path));
   for(const entry of plan.entries)assert.ok(staged.has(entry.path),`Missing pinned app data: ${entry.path}`);
 }
 console.log(`Editor stage verified: ${profile.mode}, ${evidence.files.length} files.`);return evidence;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await checkShellStage();
