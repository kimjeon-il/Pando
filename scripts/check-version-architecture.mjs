import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  MIN_SUPPORTED_PROJECT_SCHEMA_VERSION,
  PROJECT_SCHEMA_VERSION,
  VERSION_POLICY,
} from '../assets/js/modules/version-contract.js';
import {
  PROJECT_MIGRATIONS,
  migrationPath,
} from '../assets/js/modules/project-migrations.js';
import {
  EXCHANGE_TARGETS,
  EXCHANGE_TARGET_DESCRIPTORS,
} from '../assets/js/modules/exchange-adapter-registry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];
const fail = message => failures.push(message);

const packageJson = JSON.parse(read('package.json'));
const appVersion = String(packageJson.version || '').trim();
if (!/^\d+\.\d+\.\d+$/.test(appVersion)) fail(`package.json app version is not x.y.z: ${appVersion}`);
if (VERSION_POLICY.appVersionSource !== 'package.json') fail('app version source must remain package.json');
if (VERSION_POLICY.projectSchemaIndependentFromAppVersion !== true) fail('project schema must stay independent from app version');

const readmeVersion = read('README.md').match(/^# .*?v(\d+\.\d+\.\d+)/m)?.[1] || '';
if (readmeVersion !== appVersion) fail(`README version ${readmeVersion || '(missing)'} does not match package.json ${appVersion}`);
const buildGenerator = read('scripts/generate-build-metadata.mjs');
for (const marker of ['readmePath', 'data-app-version', 'README 최신 버전 제목']) {
  if (!buildGenerator.includes(marker)) fail(`build metadata generator must derive version displays from package.json: ${marker}`);
}

if (!Number.isInteger(PROJECT_SCHEMA_VERSION) || !Number.isInteger(MIN_SUPPORTED_PROJECT_SCHEMA_VERSION)) {
  fail('project schema versions must be integers');
} else if (MIN_SUPPORTED_PROJECT_SCHEMA_VERSION > PROJECT_SCHEMA_VERSION) {
  fail('minimum supported project schema may not exceed the current schema');
}

const expectedMigrationKeys = [];
for (let version = MIN_SUPPORTED_PROJECT_SCHEMA_VERSION; version < PROJECT_SCHEMA_VERSION; version += 1) expectedMigrationKeys.push(String(version));
const actualMigrationKeys = Object.keys(PROJECT_MIGRATIONS).sort((a, b) => Number(a) - Number(b));
if (JSON.stringify(actualMigrationKeys) !== JSON.stringify(expectedMigrationKeys)) {
  fail(`migration chain must be contiguous: expected ${expectedMigrationKeys.join(', ') || '(none)'}, got ${actualMigrationKeys.join(', ') || '(none)'}`);
}
if (migrationPath(MIN_SUPPORTED_PROJECT_SCHEMA_VERSION).length !== PROJECT_SCHEMA_VERSION - MIN_SUPPORTED_PROJECT_SCHEMA_VERSION) {
  fail('migrationPath() does not cover the full supported project schema range');
}

const modulesDirectory = path.join(root, 'assets/js/modules');
for (const name of fs.readdirSync(modulesDirectory).filter(file => file.endsWith('.js'))) {
  if (name === 'version-contract.js') continue;
  const source = read(`assets/js/modules/${name}`);
  for (const constant of ['PROJECT_SCHEMA_VERSION', 'GENERIC_FEATURE_SCHEMA_VERSION', 'SOURCE_PROVENANCE_SCHEMA_VERSION']) {
    if (new RegExp(`export\\s+const\\s+${constant}\\s*=`).test(source)) {
      fail(`${name} redefines ${constant}; shared schema versions belong in version-contract.js`);
    }
  }
}

const projectState = read('assets/js/modules/project-state.js');
if (!projectState.includes("import { migrateProjectInPlace } from './project-migrations.js';")) fail('project-state must import the project migration gate');
if (!projectState.includes('migrateProjectInPlace(project)')) fail('project-state must migrate supported older schemas before validation');

const serializer = read('assets/js/modules/project-serializer.js');
if (!serializer.includes('schemaVersion = PROJECT_SCHEMA_VERSION')) fail('project serializer must default to the central project schema version');
if (!serializer.includes('genericFeatureSchemaVersion = GENERIC_FEATURE_SCHEMA_VERSION')) fail('project serializer must default to the central Generic schema version');

const targetKeys = Object.values(EXCHANGE_TARGETS);
for (const target of targetKeys) {
  const descriptor = EXCHANGE_TARGET_DESCRIPTORS[target];
  if (!descriptor) fail(`missing exchange target descriptor: ${target}`);
  else if (!descriptor.domain) fail(`exchange target ${target} has no domain`);
}
if (EXCHANGE_TARGET_DESCRIPTORS.generic?.fallback !== true) fail('Generic exchange target must remain fallback-only');

const importPlan = read('assets/js/modules/import-plan.js');
if (!importPlan.includes("from './exchange-adapter-registry.js'")) fail('import-plan must derive canonical targets from exchange-adapter-registry.js');
const importService = read('assets/js/modules/import-service.js');
if (!importService.includes('createExchangeAdapterRegistry')) fail('import-service must dispatch ordinary imports through the exchange adapter registry');
if (!importService.includes('exchangeRegistry: adapters')) fail('import-service must expose its exchange registry for diagnostics/tests');

if (!fs.existsSync(path.join(root, 'docs/architecture/versioning-migrations-exchange.md'))) {
  fail('versioning/migration/exchange architecture documentation is missing');
}

if (failures.length) {
  console.error(`Version/migration architecture check failed with ${failures.length} issue(s):`);
  for (const message of [...new Set(failures)]) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log(`Version/migration architecture OK: app ${appVersion}, project schema ${MIN_SUPPORTED_PROJECT_SCHEMA_VERSION}→${PROJECT_SCHEMA_VERSION}, ${targetKeys.length} exchange targets.`);
}
