export function approvedSystemsFromReview(review) {
  const systems = {};
  for (const entry of review?.entries || []) {
    if (entry.status !== 'accepted-candidate') continue;
    systems[String(entry.systemId)] = {
      nameKo: entry.recommendedNameKo,
      localName: entry.localName,
      language: entry.language,
      aliases: entry.aliases || [],
      sources: (entry.sources || []).map(source => source.url).filter(Boolean),
      ...(entry.hangulize ? { hangulize: entry.hangulize } : {}),
    };
  }
  return systems;
}

export function promoteCoreMetadata(core, systems) {
  return {
    ...core,
    features: (core.features || []).map(feature => {
      const override = systems[String(feature.systemId || '')];
      if (!override?.nameKo) return feature;
      return { ...feature, name: override.nameKo, mainstemNameKo: override.nameKo };
    }),
  };
}

export function promoteManifest(source, coreFile) {
  const previous = '../v0.13.0/';
  const compressedDelta = Number(coreFile.bytes) - Number(source.metadata.core.bytes || 0);
  return {
    ...source,
    version: '0.13.1',
    index: { ...source.index, url: `${previous}${source.index.url}` },
    metadata: {
      ...source.metadata,
      core: { url: 'metadata-core.json.gz', bytes: coreFile.bytes, sha256: coreFile.sha256 },
      detail: { ...source.metadata.detail, url: `${previous}${source.metadata.detail.url}` },
    },
    shards: (source.shards || []).map(shard => ({ ...shard, url: `${previous}${shard.url}` })),
    cache: { ...source.cache, name: `pandolab-water-v0.13.1-${String(coreFile.sha256).slice(0, 12)}` },
    stats: {
      ...source.stats,
      compressedBytes: Number(source.stats?.compressedBytes || 0) + compressedDelta,
    },
  };
}
