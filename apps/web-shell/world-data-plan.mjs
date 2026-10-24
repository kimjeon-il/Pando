// The packaged map data closure is derived only from the Web manifests.
// Keep current world, local physical map and place shard resources together.
const HEX = /^[a-f0-9]{64}$/;
const PREFIX = 'assets/data/';
const LIBRARY_ROOT = 'assets/data/territorial-entities/generated/v2/';
const PREPARED_ROOT = 'assets/data/prepared-polygons/generated/v2/';

export function buildFullWorldAssetPlan({ meta, world, historical, library, prepared, hydro, places }) {
  if (!meta?.builtinWorld || !meta?.territorialIndex || !meta?.preparedPolygonMeshes
      || !/^data-[a-f0-9]{32}$/.test(meta.dataRevision || '')) {
    throw new Error('Current published world metadata is required.');
  }
  if (world?.schema !== 'pandolab-world-bundle' || world.schemaVersion !== 1
      || world.source?.countryCount !== 258 || !world.assets) {
    throw new Error('Current world manifest is not a 258-country world bundle.');
  }
  if (historical?.schema !== 'pandolab-builtin-world' || historical.schemaVersion !== 2 || !Array.isArray(historical.entities)) {
    throw new Error('Builtin world country index is unavailable.');
  }
  if (library?.schemaVersion !== 2 || !Array.isArray(library.entities) || !library.entities.length
      || prepared?.schemaVersion !== 2 || !prepared.meshes) {
    throw new Error('World library or prepared polygon manifest is unavailable.');
  }
  const classification = world.defaultClassification;
  const rootCount = Object.keys(classification?.countries || {}).length;
  const unitCount = Object.keys(classification?.units || {}).length;
  const removedCount = Array.isArray(classification?.removedIds) ? classification.removedIds.length : -1;
  if (rootCount <= 0 || rootCount + removedCount !== world.source.countryCount
      || unitCount > removedCount) {
    throw new Error('World classification counts do not match source feature count.');
  }
  const modelEntityCount = rootCount + unitCount;
  const files = new Map();
  function add(path, spec = null) {
    if (typeof path !== 'string' || !path.startsWith(PREFIX) || path.includes('\\')
        || path.includes('?') || path.includes('#') || path.includes('%')
        || !/^[a-zA-Z0-9_./-]+$/.test(path)
        || path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Unsafe bundled world resource path.');
    }
    const sha256 = spec?.sha256 || null;
    const bytes = spec?.compressedBytes ?? null;
    if (spec && (!HEX.test(sha256) || !Number.isSafeInteger(bytes) || bytes <= 0)) {
      throw new Error('World resource has no valid integrity pin.');
    }
    if (files.has(path)) throw new Error('Duplicate bundled world resource.');
    files.set(path, { path, sha256, bytes });
  }
  add('assets/data/world/current.json');
  const roles = ['previewCountries', 'previewMesh', 'canonicalCountryPacket', 'canonicalMesh', 'labelAnchors'];
  for (const role of roles) {
    const spec = world.assets[role];
    if (!spec || !spec.url?.startsWith('world/objects/')
        || !spec.url.includes('-sha256-' + spec.sha256)) {
      throw new Error('World manifest asset does not match its immutable path.');
    }
    add('assets/data/' + spec.url, spec);
  }
  for (const role of ['preview', 'canonical']) {
    const name = world.compatibility?.sharedBoundaries?.[role];
    if (!name || !new RegExp('^countries-' + role + '-shared-v[0-9]+\\.[0-9]+\\.[0-9]+\\.json\\.gz$').test(name)) {
      throw new Error('A current shared-border asset is required.');
    }
    add('assets/data/' + name);
  }
  add('assets/data/builtin-world/generated/v1/index.json', meta.builtinWorld);
  const transport = historical.transport;
  if (transport?.schemaVersion !== 1 || transport.encoding !== 'identity'
      || !/^transport\/countries-sha256-[a-f0-9]{64}\.bin$/.test(transport.url)
      || !HEX.test(transport.sha256) || !transport.url.includes(transport.sha256)
      || !Number.isSafeInteger(transport.compressedBytes) || transport.compressedBytes <= 0
      || transport.decodedBytes !== transport.compressedBytes) {
    throw new Error('Invalid builtin country transport.');
  }
  add('assets/data/builtin-world/generated/v1/' + transport.url, transport);
  for(const entry of historical.entities){
    if(!/^countries\/[A-Za-z0-9_-]+-sha256-[a-f0-9]{64}\.json\.gz$/.test(entry.file)||!entry.file.includes(entry.sha256))throw new Error('Invalid builtin country file');
  }
  add(LIBRARY_ROOT + 'index.json', meta.territorialIndex);
  for (const item of library.entities) {
    if (!/^state-[A-Za-z0-9_-]+\.json\.gz$/.test(item.file || '')) {
      throw new Error('Invalid library entity resource name.');
    }
    add(LIBRARY_ROOT + item.file, item);
  }
  add(PREPARED_ROOT + 'manifest.json', meta.preparedPolygonMeshes);
  for (const spec of Object.values(prepared.meshes)) {
    if (!spec.url?.startsWith(PREPARED_ROOT)
        || !new RegExp('^' + PREPARED_ROOT.replaceAll('/', '\\/') + 'polygon-mesh-sha256-[a-f0-9]{64}\\.bin\\.gz$').test(spec.url)
        || !spec.url.includes('-sha256-' + spec.sha256)) {
      throw new Error('Invalid pinned polygon mesh resource path.');
    }
    add(spec.url, spec);
  }
  // Physical resources are packaged, not eagerly decoded. The unchanged
  // Web loaders schedule tile and shard reads according to map visibility.
  const worldFileCount = files.size;
  if (hydro?.version !== '0.13.2' || hydro.schema !== 'pandolab-water-shards-v5'
      || hydro.container?.url !== 'hydro.bin'
      || hydro.container?.bytes !== hydro.stats?.compressedBytes) {
    throw new Error('Local hydro packfile contract is invalid.');
  }
  add('assets/data/hydro/v0.13.2/manifest.json');
  add('assets/data/hydro/v0.13.2/hydro.bin', {
    sha256: hydro.container.sha256, compressedBytes: hydro.container.bytes,
  });
  if (places?.version !== 1 || !places.revision
      || places.shards?.['places-v1']?.url !== 'places-v1.bin'
      || Object.keys(places.shards).length !== 1) {
    throw new Error('Local place packfile contract is invalid.');
  }
  add('assets/data/places/manifest.json');
  add('assets/data/places/places-v1.bin', {
    sha256: places.shards['places-v1'].sha256,
    compressedBytes: places.shards['places-v1'].bytes,
  });
  return Object.freeze({
    worldFileCount,
    physicalFileCount: files.size - worldFileCount,
    countryCount: world.source.countryCount,
    rootCount, unitCount, modelEntityCount, mergedSourceCount: removedCount - unitCount,
    sourceSha256: world.source.sha256,
    entries: Object.freeze([...files.values()]),
  });
}

export async function loadFullWorldAssetPlan(readText){
    const metaSource = await readText('assets/js/build-meta.js');
    const metaLiteral = metaSource.match(/Object\.freeze\((\{[\s\S]*\})\);\s*$/)?.[1];
    if (!metaLiteral) throw new Error('Current published build metadata is required for the full world.');
    const meta = JSON.parse(metaLiteral);
    const loadManifest = async path => JSON.parse(await readText(path));
    const plan = buildFullWorldAssetPlan({
      meta,
      world: await loadManifest('assets/data/world/current.json'),
      historical: await loadManifest('assets/data/builtin-world/generated/v1/index.json'),
      library: await loadManifest('assets/data/territorial-entities/generated/v2/index.json'),
      prepared: await loadManifest('assets/data/prepared-polygons/generated/v2/manifest.json'),
      hydro: await loadManifest('assets/data/hydro/v0.13.2/manifest.json'),
      places: await loadManifest('assets/data/places/manifest.json'),
    });
    return {plan,meta};
}
