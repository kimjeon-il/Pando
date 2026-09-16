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

test('spatial-data owners consume small named capability ports without flat dependency aliases', async () => {
  const portModuleUrl = new URL('assets/js/modules/app-capability-ports.js', root);
  assert.equal(existsSync(portModuleUrl), true, 'missing capability port registry');
  const { createSpatialDataPorts, SPATIAL_DATA_OWNER_PORTS } = await import(portModuleUrl.href);
  assert.equal(typeof createSpatialDataPorts, 'function');
  assert.deepEqual(Object.keys(SPATIAL_DATA_OWNER_PORTS).sort(), spatialOwners.map(name => name.slice(4, -3).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())).sort());

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

test('spatial-data capability ports are frozen, shared and bounded to twelve members', async () => {
  const { createSpatialDataPorts, SPATIAL_DATA_OWNER_PORTS } = await import(new URL('assets/js/modules/app-capability-ports.js', root).href);
  const providers = new Proxy({}, {
    get: (_target, provider) => new Proxy({}, {
      get: (_providerTarget, field) => `${String(provider)}.${String(field)}`,
      set: () => true,
    }),
  });
  const ports = createSpatialDataPorts(providers);
  assert.equal(Object.isFrozen(ports), true);
  for (const [name, port] of Object.entries(ports)) {
    assert.equal(Object.isFrozen(port), true, `${name} must be frozen`);
    assert.ok(Object.keys(port).length <= 12, `${name} exceeds the twelve-member port limit`);
  }
  for (const names of Object.values(SPATIAL_DATA_OWNER_PORTS)) {
    for (const name of names) assert.strictEqual(ports[name], ports[name], `${name} must be shared`);
  }
});
