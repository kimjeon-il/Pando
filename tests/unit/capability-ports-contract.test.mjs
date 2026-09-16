import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = relativePath => readFileSync(new URL(relativePath, root), 'utf8');
const spatialOwners = [
  'app-camera-navigation.js',
  'app-readiness-notifications.js',
  'app-country-index.js',
  'app-spatial-index.js',
  'app-geometry-preview.js',
  'app-territory-components.js',
  'app-country-validation.js',
  'app-land-relations.js',
];
const mapResourceOwners = [
  'app-cut-geometry.js',
  'app-map-projection.js',
  'app-object-presentation.js',
  'app-hydro-settings.js',
  'app-layer-list.js',
  'app-country-labels.js',
  'app-physical-resources.js',
  'app-interaction-packets.js',
];
const remainingOwnerGroups = {
  FOUNDATION_OWNER_PORTS: [
    'app-environment.js', 'app-builtin-session.js', 'app-workspace-surfaces.js', 'app-project-session.js',
    'app-object-commands.js', 'app-service-assembly.js', 'app-render-quality.js', 'app-pointer-targets.js',
  ],
  MAP_INTERACTION_OWNER_PORTS: [
    'app-territory-component-ui.js', 'app-gpu-scene.js', 'app-map-audit.js', 'app-map-host.js',
    'app-task-presentation.js', 'app-country-modes.js', 'app-object-picking.js', 'app-river-candidates.js',
  ],
  OBJECT_EDITING_OWNER_PORTS: [
    'app-territory-selection-workflow.js', 'app-country-commits.js', 'app-generic-commands.js',
    'app-property-selection.js', 'app-territorial-drafts.js', 'app-color-picker.js', 'app-object-metadata.js',
    'app-territorial-conversion.js', 'app-project-snapshots.js',
  ],
  PROJECT_IO_OWNER_PORTS: [
    'app-map-settings.js', 'app-history-assembly.js', 'app-project-restore.js', 'app-object-deletion.js',
    'app-gis-assembly.js', 'app-library-assembly.js', 'app-navigation-bindings.js', 'app-tool-bindings.js',
  ],
  LIFECYCLE_UI_OWNER_PORTS: [
    'app-file-bindings.js', 'app-global-input-bindings.js', 'app-editor-bindings.js',
    'app-progressive-startup.js', 'app-domain-assembly.js', 'app-lifecycle-assembly.js',
  ],
};
const ownerName = file => file.slice(4, -3).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

test('spatial-data owners consume small named capability ports without flat dependency aliases', async () => {
  const portModuleUrl = new URL('assets/js/modules/app-capability-ports.js', root);
  assert.equal(existsSync(portModuleUrl), true, 'missing capability port registry');
  const { createSpatialDataPorts, SPATIAL_DATA_OWNER_PORTS } = await import(portModuleUrl.href);
  assert.equal(typeof createSpatialDataPorts, 'function');
  assert.deepEqual(Object.keys(SPATIAL_DATA_OWNER_PORTS).sort(), spatialOwners.map(ownerName).sort());

  for (const file of spatialOwners) {
    const source = read(`assets/js/modules/${file}`);
    const accesses = [...source.matchAll(/\bdependencies\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)];
    assert.ok(accesses.length > 0, `${file} should consume injected ports`);
    for (const [, group, member] of accesses) {
      assert.ok(member, `${file} retains flat dependency access: dependencies.${group}`);
      assert.ok(!/^runtime|environment$/i.test(group), `${file} exposes provider-shaped port: ${group}`);
    }
  }
});

test('map-resources owners use the shared application registry without flat dependencies', async () => {
  const module = await import(new URL('assets/js/modules/app-capability-ports.js', root).href);
  assert.equal(typeof module.createApplicationPorts, 'function');
  assert.deepEqual(Object.keys(module.MAP_RESOURCE_OWNER_PORTS).sort(), mapResourceOwners.map(ownerName).sort());
  for (const file of mapResourceOwners) {
    const source = read(`assets/js/modules/${file}`);
    const accesses = [...source.matchAll(/\bdependencies\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)];
    assert.ok(accesses.length > 0, `${file} should consume injected ports`);
    for (const [, group, member] of accesses) {
      assert.ok(member, `${file} retains flat dependency access: dependencies.${group}`);
      assert.ok(!/^runtime|environment$/i.test(group), `${file} exposes provider-shaped port: ${group}`);
    }
  }
  const composition = read('assets/js/modules/app-composition.js');
  assert.match(composition, /createApplicationPorts/);
  assert.match(composition, /ports:\s*applicationPorts/g);
});

test('remaining connector domains expose owner contracts without flat dependency access', async () => {
  const module = await import(new URL('assets/js/modules/app-capability-ports.js', root).href);
  const providers = new Proxy({}, {
    get: (_target, provider) => new Proxy({}, {
      get: (_providerTarget, field) => `${String(provider)}.${String(field)}`,
      set: () => true,
    }),
  });
  const ports = module.createApplicationPorts(providers);
  for (const [contractName, files] of Object.entries(remainingOwnerGroups)) {
    assert.ok(module[contractName], `${contractName} missing`);
    assert.deepEqual(Object.keys(module[contractName]).sort(), files.map(ownerName).sort());
    for (const file of files) {
      const source = read(`assets/js/modules/${file}`);
      const accesses = [...source.matchAll(/\bdependencies\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)];
      assert.ok(accesses.length > 0, `${file} should consume injected ports`);
      for (const [, group, member] of accesses) {
        assert.ok(member, `${file} retains flat dependency access: dependencies.${group}`);
        assert.ok(!/^runtime|environment$/i.test(group), `${file} exposes provider-shaped port: ${group}`);
        assert.ok(module[contractName][ownerName(file)].includes(group), `${file} uses undeclared port: ${group}`);
        assert.ok(Object.hasOwn(ports[group], member), `${file} uses undeclared capability: ${group}.${member}`);
      }
      assert.doesNotMatch(source, /\bdependencies\.[A-Za-z_$][\w$]*\s*(?:\+=|=)/, `${file} retains dependency assignment`);
    }
  }
});

test('map-resources writes use explicit capability commands', async () => {
  const state = {
    spatialIndex: { applyingMapEditWorkerResult: false },
    objectPresentation: { distributionVisibilityRevision: 2 },
    environment: { resolvedAccentColor: '#000000', userPreferences: { theme: 'system' } },
  };
  const providers = new Proxy(state, { get: (target, key) => target[key] ||= {} });
  const { createApplicationPorts } = await import(new URL('assets/js/modules/app-capability-ports.js', root).href);
  const ports = createApplicationPorts(providers);
  ports.geometryMutation.setApplyingWorkerResult(true);
  ports.distributionPresentation.bumpVisibilityRevision();
  ports.preferences.setResolvedAccentColor('#123456');
  ports.preferences.setUserPreferences({ theme: 'dark' });
  assert.equal(state.spatialIndex.applyingMapEditWorkerResult, true);
  assert.equal(state.objectPresentation.distributionVisibilityRevision, 3);
  assert.equal(state.environment.resolvedAccentColor, '#123456');
  assert.deepEqual(state.environment.userPreferences, { theme: 'dark' });
});

test('application capability ports are frozen, shared and bounded to twelve members', async () => {
  const module = await import(new URL('assets/js/modules/app-capability-ports.js', root).href);
  const { createApplicationPorts, MAP_RESOURCE_OWNER_PORTS, SPATIAL_DATA_OWNER_PORTS } = module;
  const providers = new Proxy({}, {
    get: (_target, provider) => new Proxy({}, {
      get: (_providerTarget, field) => `${String(provider)}.${String(field)}`,
      set: () => true,
    }),
  });
  const ports = createApplicationPorts(providers);
  assert.equal(Object.isFrozen(ports), true);
  for (const [name, port] of Object.entries(ports)) {
    assert.equal(Object.isFrozen(port), true, `${name} must be frozen`);
    assert.ok(Object.keys(port).length <= 12, `${name} exceeds the twelve-member port limit`);
  }
  const remainingContracts = Object.keys(remainingOwnerGroups).flatMap(name => Object.values(module[name]));
  for (const names of [...Object.values(SPATIAL_DATA_OWNER_PORTS), ...Object.values(MAP_RESOURCE_OWNER_PORTS), ...remainingContracts]) {
    for (const name of names) assert.strictEqual(ports[name], ports[name], `${name} must be shared`);
  }
});
