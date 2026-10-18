import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadFullWorldAssetPlan} from './world-data-plan.mjs';

/** Verify the current product contract, independently of a historical file count. */
export async function checkShellStage(root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')){
 const directory=resolve(root,'apps/web-shell/dist');
 const evidence=JSON.parse(await readFile(resolve(directory,'shell/stage-evidence.json'),'utf8'));
 const profile=JSON.parse(await readFile(resolve(directory,'shell/stage-profile.json'),'utf8'));
 assert.ok(evidence.files.some(file=>file.path==='index.html'));
 const html=await readFile(resolve(directory,'index.html'),'utf8');
 assert.match(html,/assets\/js\/bootstrap\.js/);assert.doesNotMatch(html,/<script\b[^>]*src=["'][^"']*assets\/js\/viewer\.js/);
 if(profile.mode==='full-world'){
   const {plan}=await loadFullWorldAssetPlan(path=>readFile(resolve(root,path),'utf8'));
   for(const key of ['worldFileCount','physicalFileCount','countryCount','rootCount','unitCount','modelEntityCount','mergedSourceCount','sourceSha256'])assert.equal(evidence.worldData[key],plan[key],key);
   assert.equal(evidence.worldData.fileCount,plan.entries.length);
   const staged=new Set(evidence.files.map(file=>file.path));
   for(const entry of plan.entries)assert.ok(staged.has(entry.path),`Missing pinned app data: ${entry.path}`);
 }
 console.log(`Editor stage verified: ${profile.mode}, ${evidence.files.length} files.`);return evidence;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await checkShellStage();
