import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { PROJECT_COMMAND_KINDS } from '../assets/js/modules/project-command-pipeline.js';

const root = process.cwd();
const failures = [];
const required = [
  'assets/js/modules/project-command-pipeline.js',
  'assets/js/modules/document-mutation-runner.js',
];
const services = [
  'assets/js/modules/territorial-service.js',
  'assets/js/modules/distribution-service.js',
  'assets/js/modules/generic-feature-service.js',
];
const appSource = fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8');
const projectDomainSource = fs.readFileSync(path.join(root, 'assets/js/modules/project-domain.js'), 'utf8');
const mutationRunnerSource = fs.readFileSync(path.join(root, 'assets/js/modules/document-mutation-runner.js'), 'utf8');
const legacyMutationCallback = ['run', 'Document', 'Mutation'].join('');

for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) failures.push(`missing application architecture module: ${relative}`);
}

if (PROJECT_COMMAND_KINDS.VIEW !== 'view' || PROJECT_COMMAND_KINDS.DOCUMENT !== 'document') {
  failures.push('project command pipeline must distinguish view and document commands');
}

for (const relative of services) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  if (!source.includes("createDocumentMutationRunner")) failures.push(`${relative} must resolve document mutations through the shared mutation runner`);
  if (!source.includes('const mutateDocument = createDocumentMutationRunner')) failures.push(`${relative} does not establish a canonical mutation boundary`);
  if (!source.includes('renderDirty: { domain:')) failures.push(`${relative} must provide semantic render descriptors for document mutations`);
  for (const forbidden of ['recordHistory(', 'renderAll(', 'queueAutosave(']) {
    if (source.includes(forbidden)) failures.push(`${relative} must not own ${forbidden.slice(0, -1)} side effects`);
  }
}

const pipelineCreations = appSource.match(/createProjectCommandPipeline\s*\(\s*\{/g) || [];
if (pipelineCreations.length !== 1) failures.push(`app bootstrap must create exactly one ProjectCommandPipeline (found ${pipelineCreations.length})`);
const pipelineInjections = appSource.match(/commandPipeline:\s*projectCommandPipeline/g) || [];
if (pipelineInjections.length !== 4) failures.push(`the same ProjectCommandPipeline must be injected into three services and ProjectDomain (found ${pipelineInjections.length})`);
if (appSource.includes(legacyMutationCallback)) failures.push('app bootstrap must not use the legacy document mutation callback');
if (mutationRunnerSource.includes(legacyMutationCallback)) failures.push('document mutation runner must not retain the legacy callback fallback');
if (!projectDomainSource.includes('commandPipeline.execute(id,')) failures.push('ProjectDomain.dispatch must delegate to commandPipeline.execute(id, context, payload)');
for (const forbidden of ['commandPipeline.dispatch', 'command?.execute', 'command?.type', 'command?.name']) {
  if (projectDomainSource.includes(forbidden)) failures.push(`ProjectDomain must not retain legacy dispatch path: ${forbidden}`);
}

const pipelineSource = fs.readFileSync(path.join(root, 'assets/js/modules/project-command-pipeline.js'), 'utf8');
for (const contract of ['captureSnapshot', 'recordHistory', 'validateProject', 'advanceRevision', 'invalidateRender', 'queueAutosave', 'restoreSnapshot']) {
  if (!pipelineSource.includes(contract)) failures.push(`project command pipeline is missing ${contract}`);
}
if (!pipelineSource.includes('runProjectTransaction for asynchronous/geometry transactions')) {
  failures.push('sync command pipeline must preserve the async geometry transaction boundary');
}

if (failures.length) {
  console.error(`Application command architecture audit failed with ${failures.length} issue(s):`);
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Application command architecture audit passed: adapters, command pipeline and service mutation boundary are canonical.');
}
