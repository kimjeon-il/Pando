import assert from 'node:assert/strict';
import {editorStageRoot} from '../../tools/worktree-storage.mjs';
import { createHash } from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildFrontendSnapshot} from '../../scripts/lib/frontend-build.mjs';
import {summarizeViewerWorldData} from './world-data-plan.mjs';

/** Verify the current product contract, independently of a historical file count. */
export async function checkShellStage(root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')){
 const directory=resolve(editorStageRoot(root),'dist');
 const evidence=JSON.parse(await readFile(resolve(directory,'shell/stage-evidence.json'),'utf8'));
 const profile=JSON.parse(await readFile(resolve(directory,'shell/stage-profile.json'),'utf8'));
 assert.equal(profile.verification, evidence.verification, 'Stage mode identity mismatch');
 const verificationFiles = ['review-probe.js'];
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
 if (profile.mode === 'map-data') assert.ok(evidence.files.some(file=>file.path===metadata.physicalLand.url), 'Physical substrate must be bundled in map-data profile');
 const html=await readFile(resolve(directory,'index.html'),'utf8');
 assert.match(html,/assets\/js\/viewer\.js/);
 assert.doesNotMatch(html,/assets\/js\/(?:bootstrap|app|gis-io)\.js/);
 assert.equal(evidence.nativeEntry,'review.html');
 const reviewHtml=await readFile(resolve(directory,'review.html'),'utf8');
 assert.match(reviewHtml,/id="reviewPanel"/);
 assert.match(reviewHtml,/assets\/js\/viewer\.js/);
 for(const banned of ['assets/js/bootstrap.js','assets/js/app.js','assets/js/gis-io.js',
   'shell/startup.js','shell/native-storage.js','shell/document-transfer-contract.js'])
   assert.ok(!evidence.files.some(file=>file.path===banned), 'Legacy editor asset staged: '+banned);
 if(profile.mode==='map-data'){
   const snapshot=await buildFrontendSnapshot({root,resourceProfile:'map-data'});
   const dataPaths=[...snapshot.viewerPaths].filter(path=>path.startsWith('assets/data/'));
   const world=JSON.parse(snapshot.readPinnedRuntimeAsset('assets/data/world/current.json'));
   const bytes=evidence.files.filter(file=>file.path.startsWith('assets/data/')).reduce((n,file)=>n+file.bytes,0);
   assert.deepEqual(evidence.worldData,summarizeViewerWorldData({world,paths:dataPaths,bytes,dataRevision:snapshot.dataRevision}));
   const staged=new Set(evidence.files.map(file=>file.path));
   for(const path of dataPaths)assert.ok(staged.has(path),`Missing pinned app data: ${path}`);
   assert.ok(!staged.has('assets/data/territorial-entities/generated/v2/index.json'),'Source library entered Windows review output');
 }
 console.log(`Windows review stage verified: ${profile.mode}, ${evidence.files.length} files.`);return evidence;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await checkShellStage();
