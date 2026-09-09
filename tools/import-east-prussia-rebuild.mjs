// Explicitly import a reviewed local artifact; never fetch or approximate geometry.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateGeometry } from '../assets/js/modules/geometry-validation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactPath = process.argv[2];
if (!artifactPath) throw new Error('Usage: node tools/import-east-prussia-rebuild.mjs <reviewed GeoJSON path>');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(artifactPath);
const artifact = JSON.parse(bytes);
const audit = JSON.parse(fs.readFileSync(path.join(path.dirname(artifactPath), 'verification.json'), 'utf8'));
if (artifact.features?.length !== 1 || hash(bytes) !== audit.output_sha256) throw new Error('Artifact verification mismatch');
const geometry = artifact.features[0].geometry;
if (geometry.type !== 'MultiPolygon' || validateGeometry(artifact.features[0]).length) throw new Error('Invalid reviewed geometry');
const canonicalHash = hash(fs.readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson')));
if (canonicalHash !== audit.canonical_sha256) throw new Error('Canonical geometry has changed; reconcile again before importing');
const target = path.join(root, 'assets/data/historical-library-pilot.json');
const library = JSON.parse(fs.readFileSync(target, 'utf8'));
const entity = library.entities.find(item => item.libraryId === 'historical-country:east-prussia');
if (!entity || entity.geometryVersions.length !== 1) throw new Error('Unexpected East Prussia library structure');
const version = entity.geometryVersions[0];
Object.assign(version, {
  id: 'ostpreussen-1878-1920-r3',
  geometry,
  certainty: 'medium',
  sourceId: 'lki-east-prussia-iv-2018+pandolab-canonical-0.33.0',
  notes: '1900년을 목표로 LKI의 1893년 주 경계선을 적용한 재작업본입니다. 메멜란트를 포함하며 동쪽 일부와 해안은 기본 지도에 맞췄습니다. 원자료 설명 시점은 1905–1918년으로, 1900년 독립 원도 대조는 미완료입니다. 통계 면적 대비 +2.36%로 종전 ±1% 조건은 미통과입니다.',
});
Object.assign(entity.metadata, {
  approximateGeometry: true,
  production: false,
  areaKm2: audit.area_km2,
  canonicalAssetVersion: '0.33.0',
  canonicalSourceSha256: canonicalHash,
  artifactSha256: hash(bytes),
  geometrySha256: hash(JSON.stringify(geometry)),
  sourceKmlSha256: audit.source_kml_sha256,
  validation: {
    status: 'map-aligned-historical-review-pending',
    statisticalAreaKm2: audit.statistical_area_km2,
    statisticalAreaDifferencePercent: audit.statistical_area_difference_percent,
    statisticalAreaWithinOnePercent: false,
    modernEastUnmatchedLengthM: audit.modern_east_unmatched_length_m,
    postMergeOverlapKm2: audit.post_merge_overlap_km2,
    redistributionPermission: 'unconfirmed',
  },
});
delete entity.metadata.canonicalAssetRevision;
delete entity.metadata.canonicalGzipSha256;
entity.sourceInfo = {
  title: 'Interaktive Karte Ostpreußens IV (2018), LKI / Goethe-Universität / Latvijas Universitāte; PandoLab canonical alignment',
  url: 'https://prusija.lki.lt/DE.html',
  license: 'LKI project derivative redistribution permission unconfirmed; Natural Earth public domain',
  notes: 'KML의 주 경계선과 별도 사주 경계선을 사용했습니다. 현대 칼리닌그라드 동쪽 좌표 44개와 기본 해안을 재사용했으며 연결점 이동은 약 1,766m·626m입니다. 기본 Polygon의 석호 수역 포함으로 육지 통계와 면적 차이가 있습니다. 공개 재배포 허가는 별도 확인이 필요합니다.',
};
fs.writeFileSync(target, `${JSON.stringify(library, null, 2)}\n`);
console.log(JSON.stringify({ libraryId: entity.libraryId, version: version.id,
  geometrySha256: entity.metadata.geometrySha256, artifactSha256: entity.metadata.artifactSha256 }));
