// Verify only retained, runnable tests and active CI inputs.
// Removed historical tests are intentionally not kept as contracts.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadRepository} from './plan-application-checks.mjs';
import {auditWorkflowReferences} from './lib/workflow-reference-integrity.mjs';

const explicitTest = /tests\/(?:unit|browser|native|integration|cpp)\/[\w./-]+\.(?:test|spec)\.mjs/g;
const registrationSources = path => path === 'package.json' ||
  /^\.github\/(?:workflows|actions)\//.test(path) ||
  (path.startsWith('scripts/') && /\.(?:mjs|js|json|yaml|yml)$/.test(path));

export function auditConsolidatedTestRegistry(repository = loadRepository()) {
  const workflow = auditWorkflowReferences(repository.root);
  const missingReferences = [], missingBindings = [], emptyUnitSuites = [];
  const missingActivePerformanceTests = [];
  if (repository.exists('config/performance-baseline-v1.json')) {
    const manifest = JSON.parse(repository.read('config/performance-baseline-v1.json'));
    for (const suite of manifest.activeSuites || []) for (const file of suite.tests || [])
      if (!repository.exists(file)) missingActivePerformanceTests.push({suite: suite.id, file});
  }
  for (const file of repository.files.filter(registrationSources)) {
    for (const match of repository.read(file).matchAll(explicitTest))
      if (!repository.exists(match[0])) missingReferences.push({file, reference: match[0]});
  }
  for (const binding of repository.catalog.bindings || [])
    for (const file of binding.tests || [])
      if (!file.includes('*') && !repository.owners.has(file))
        missingBindings.push({file, inputs: binding.inputs || []});
  for (const file of repository.tests.filter(file => file.startsWith('tests/unit/'))) {
    const source = repository.read(file);
    if (!/\b(?:test|it|describe|contractSuite|featureDescribe)\s*\(/.test(source))
      emptyUnitSuites.push(file);
  }
  const issues = {
    invalidWorkflowReferences: workflow,
    missingDirectTestReferences: missingReferences,
    missingActivePerformanceTests,
    missingBindings,
    emptyUnitSuites,
  };
  return {ok:Object.values(issues).every(rows => rows.length === 0),
    units:repository.tests.filter(file => file.startsWith('tests/unit/')).length,
    activeTests:repository.tests.length, issues};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = auditConsolidatedTestRegistry(); console.log(JSON.stringify(result,null,2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
