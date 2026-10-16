// The packaged full-world data closure is derived only from the Web manifests.
// It is deliberately separate from physical (terrain/hydro) and place resources.
const HEX = /^[a-f0-9]{64}$/;
const PREFIX = 'assets/data/';
const WORLD_ROOT = 'assets/data/world/objects/';
const LIBRARY_ROOT = 'assets/data/territorial-entities/generated/v2/';
const PREPARED_ROOT = 'assets/data/prepared-polygons/generated/v2/';

export function buildFullWorldAssetPlan({ meta, world, historical, library, prepared }) {
  if (!meta?.historicalWorld || !meta?.territorialIndex || !meta?.preparedPolygonMeshes
      || !/^data-[a-f0-9]{32}$/.test(meta.dataRevision || '')) {
    throw new Error('Current published world metadata is required.');
  }
  if (world?.schema !== 'pandolab-world-bundle' || world.schemaVersion !== 1
      || world.source?.countryCount !== 258 || !world.assets) {
    throw new Error('Current world manifest is not a 258-country world bundle.');
  }
  if (historical?.schemaVersion !== 1 || historical.project?.encoding !== 'gzip'
      || !/^\d{4}-\d{2}$/.test(historical.sourceMonth || '')) {
    throw new Error('Historical world manifest is not the current project contract.');
  }
  if (library?.schemaVersion !== 2 || !Array.isArray(library.entities) || !library.entities.length
      || prepared?.schemaVersion !== 2 || !prepared.meshes) {
    throw new Error('World library or prepared polygon manifest is unavailable.');
  }
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
  add('assets/data/historical-world/generated/v1/manifest.json', meta.historicalWorld);
  if (historical.project.url !== 'assets/data/historical-world/generated/v1/world-project.json.gz') {
    throw new Error('Unexpected historical world project path.');
  }
  add(historical.project.url, historical.project);
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
  return Object.freeze({
    countryCount: world.source.countryCount,
    sourceSha256: world.source.sha256,
    entries: Object.freeze([...files.values()]),
  });
}
