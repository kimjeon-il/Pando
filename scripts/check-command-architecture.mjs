import fs from 'node:fs';
import {buildFrontendIndex,frontendAsset,emitFrontendModule} from './lib/frontend-layout.mjs';
import path from 'node:path';
import process from 'node:process';

const root=process.cwd(),failures=[];
const index=buildFrontendIndex(root);
const read=relative=>index.has(relative)?emitFrontendModule(frontendAsset(root,relative,{index}).bytes.toString('utf8'),index.get(relative).sourcePath,index):fs.readFileSync(path.join(root,relative),'utf8');
const required=['assets/js/modules/core-document-client.js','assets/js/modules/core-document-read-model.js',
  'assets/js/modules/project-domain.js','assets/js/modules/territorial-entity-store.js',
  'shared/core/include/pandoeditor/document-session.h','shared/core/src/document-session.cpp','shared/wasm/session-bindings.cpp'];
for(const file of required)if(!index.has(file)&&!fs.existsSync(path.join(root,file)))failures.push(`Missing canonical document boundary: ${file}`);
const retired=['project-command-pipeline.js','document-mutation-runner.js','history-service.js','draft-editor.js','project-transaction.js','map-edit-transaction.js'];
for(const file of retired)if(index.has('assets/js/modules/'+file))failures.push(`Retired parallel owner remains: ${file}`);
for(const entry of [...index.keys()].filter(p=>p.startsWith('assets/js/modules/')&&p.endsWith('.js')).map(p=>({name:path.basename(p),isFile:()=>true}))) {
  if(!entry.isFile()||!entry.name.endsWith('.js'))continue;
  const source=read(`assets/js/modules/${entry.name}`);
  for(const file of retired)if(source.includes(`from './${file}'`))failures.push(`${entry.name} imports retired owner ${file}`);
}
for(const file of ['territorial-service.js','generic-feature-service.js','distribution-service.js']) {
  const source=read(`assets/js/modules/${file}`);
  if(!source.includes('commandOwner')||!source.includes('executeCommand'))failures.push(`${file} lacks the accepted C++ command boundary`);
  for(const forbidden of ['createDocumentMutationRunner','commandPipeline','recordHistory(','queueAutosave(','restoreSnapshot('])
    if(source.includes(forbidden))failures.push(`${file} owns an obsolete mutation/history side effect: ${forbidden}`);
}
const project=read('shared/frontend/js/modules/project-domain.js');
for(const contract of ['commandQueue','commandOwner.execute(envelope)','publishCommand','expectedGeneration',
  'captureReplacement','rollbackReplacement','releaseReplacement','commandOwner[direction]()','validateImport'])
  if(!project.includes(contract))failures.push(`Application command boundary is missing ${contract}`);
for(const forbidden of ['commitHistorySnapshot','createHistoryService','runMutation(','commandPipeline.execute'])
  if(project.includes(forbidden))failures.push(`Application boundary retains another history writer: ${forbidden}`);
const store=read('shared/frontend/js/modules/territorial-entity-store.js');
if(!store.includes('documentModel.territorialViews')||!store.includes('commandOwner.setTimelineCursor'))
  failures.push('Territorial Store must derive current-world rows from the same document session.');
for(const method of ['setField','setLocked','transaction','restoreProject','replaceEntities','appendEntities','removeEntities','applyChanges'])
  if(new RegExp(`\\b(?:function|const)\\s+${method}\\b|\\b${method}\\s*:`).test(store))failures.push(`Read-only Store exposes a document writer: ${method}`);
const native=read('shared/core/src/document-session.cpp');
for(const contract of ['requireEpoch','confirmCandidate','project_.historySnapshot(forward)','project_.travelHistory(forward,prospective)'])
  if(!native.includes(contract))failures.push(`Shared document session lacks ${contract}`);
if(failures.length) {
  for(const failure of failures)console.error(`- ${failure}`);
  process.exitCode=1;
}else console.log('Command ownership audit passed: one C++ document/history owner, ordered platform adapters and read-only projections.');
