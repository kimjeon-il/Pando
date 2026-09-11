import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createBuiltinSession } from '../../assets/js/modules/app-builtin-session.js';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const composition = read('assets/js/modules/app-composition.js');
const moduleNames = [...composition.matchAll(/\.\/(app-[\w-]+\.js)\?v=/g)].map(match => match[1]);

test('entry stays below 400 nonempty lines and owns only versioned composition/startup', () => {
  const source = read('assets/js/app.js');
  assert.ok(source.split(/\r?\n/).filter(line => line.trim()).length <= 400);
  assert.doesNotMatch(source, /\bfunction\b|=>|document\.|addEventListener\(|new (?:Map|Set|Worker)/);
  assert.match(source, /await composeApplication\(\{ revision \}\)/);
  assert.match(source, /void application\.start\(\)/);
  assert.match(composition, /encodeURIComponent\(revision\)/);
  assert.equal(new Set(moduleNames).size, moduleNames.length);
});

test('all owners construct without DOM access, connect once, and expose every referenced port', async () => {
  const owners = new Map();
  const handles = { runtime: {} };
  const portsByOwner = new Map();
  const runtimeSource = read('assets/js/modules/app-runtime-dependencies.js');
  for (const name of moduleNames.filter(name => !/runtime-dependencies|connect-/.test(name))) {
    const module = await import(new URL(`assets/js/modules/${name}`, root));
    const factoryName = Object.keys(module).find(key => key.startsWith('create'));
    assert.ok(factoryName, name);
    const handleName = factoryName[6].toLowerCase() + factoryName.slice(7);
    const owner = module[factoryName]();
    owners.set(handleName, owner);
    const handle = Object.create(owner);
    Object.defineProperty(handle, 'connect', { value(ports) {
      assert.equal(portsByOwner.has(handleName), false, `${handleName} connected twice`);
      portsByOwner.set(handleName, ports);
      owner.connect(ports);
    } });
    handles[handleName] = handle;
  }
  for (const name of moduleNames.filter(name => /connect-/.test(name))) {
    const module = await import(new URL(`assets/js/modules/${name}`, root));
    Object.values(module)[0](handles);
  }
  assert.equal(portsByOwner.size, owners.size);
  for (const [name, owner] of owners) {
    assert.throws(() => owner.connect({}), /already connected/, name);
    const ports = portsByOwner.get(name);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(ports))) {
      assert.equal(typeof descriptor.get, 'function', `${name}.${key} must remain a live read`);
      const [, provider, field] = descriptor.get.toString().match(/return ([$\w]+)\.([$\w]+);/) || [];
      assert.ok(provider && field, `${name}.${key} must explicitly name its provider`);
      if (provider === 'runtime') {
        assert.match(runtimeSource, new RegExp(`\\b${field}\\b`));
      } else {
        assert.ok(Object.hasOwn(owners.get(provider), field), `${provider}.${field} missing for ${name}`);
      }
      if (descriptor.set && provider !== 'runtime') {
        const original = ports[key];
        const replacement = Object.freeze({ marker: `${name}.${key}` });
        ports[key] = replacement;
        assert.strictEqual(ports[key], replacement);
        assert.strictEqual(owners.get(provider)[field], replacement);
        ports[key] = original;
      }
    }
  }
  const stages = [...composition.matchAll(/\n\s+(\w+)\.(initialize\w+)\(\);/g)];
  assert.ok(stages.length > 0);
  assert.equal(new Set(stages.map(match => `${match[1]}.${match[2]}`)).size, stages.length);
  for (const [, owner, stage] of stages) assert.equal(typeof owners.get(owner)?.[stage], 'function', `${owner}.${stage}`);
  assert.ok(composition.lastIndexOf('Connector.connect') < stages[0].index);
});

test('canonical replacement retains one live store and updates dependent ID reads', () => {
  const owner = createBuiltinSession();
  owner.connect({});
  const collectionA = { features: [{ id: 'A' }] };
  const collectionB = { features: [{ id: 'B' }] };
  const store = collection => ({
    ids: () => collection.features.map(feature => feature.id),
    materializeCollectionSync: () => collection,
    materializeFeature: id => collection.features.find(feature => feature.id === id),
    geometryEquals: () => true,
  });
  const first = store(collectionA);
  const second = store(collectionB);
  owner.installCanonicalCountryStore(first);
  assert.strictEqual(owner.canonicalCountryStore, first);
  assert.strictEqual(owner.materializePristineCountriesSync(), collectionA);
  owner.installCanonicalCountryStore(second);
  assert.strictEqual(owner.canonicalCountryStore, second);
  assert.strictEqual(owner.materializePristineCountriesSync(), collectionB);
  assert.deepEqual([...owner.builtinCountryIds], ['B']);
});
