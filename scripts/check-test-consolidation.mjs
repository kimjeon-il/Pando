// Static gate for consolidated Viewer test contracts. Does not execute tests.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadRepository} from './plan-application-checks.mjs';
import {auditUnitContractIdentities,auditGisUnitConsolidation} from './lib/unit-contract-inventory.mjs';
import {auditWorkflowReferences} from './lib/workflow-reference-integrity.mjs';

const explicitTest = /tests\/(?:unit|browser|native|integration|cpp)\/[\w./-]+\.(?:test|spec)\.mjs/g;
const registrationSources = path => path === 'package.json' ||
  /^\.github\/(?:workflows|actions)\//.test(path) ||
  (path.startsWith('scripts/') && /\.(?:mjs|js|json|yaml|yml)$/.test(path));

export function auditConsolidatedTestRegistry(repository = loadRepository()) {
  const identity = auditUnitContractIdentities(repository);
  const gis = auditGisUnitConsolidation(repository);
  const workflow = auditWorkflowReferences(repository.root);
  const missingReferences = [];
  for (const file of repository.files.filter(registrationSources)) {
    for (const match of repository.read(file).matchAll(explicitTest)) {
      if (!repository.exists(match[0])) missingReferences.push({file, reference: match[0]});
    }
  }
  const issues = {
    missingOriginalContracts: identity.missing,
    duplicateOriginalContracts: identity.duplicates,
    retiredDirectReferences: identity.staleReferences,
    invalidGisOwners: gis.errors,
    invalidWorkflowReferences: workflow,
    missingDirectTestReferences: missingReferences,
  };
  const ok = Object.values(issues).every(rows => rows.length === 0);
  return {ok, units:identity.unitFileCount, originalContracts:identity.originalContractCount,
    registeredContracts:identity.registeredContractCount, gisConsolidated:gis.mapped, issues};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = auditConsolidatedTestRegistry();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
