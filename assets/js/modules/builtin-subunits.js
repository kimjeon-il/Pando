import { createTerritorialFeature } from './territorial-units.js';
import { mergeBuiltinTerritories } from './builtin-territory-policy.js';

// User-approved default-map classification, not a live legal-status database.
// Canonical source IDs and coordinates remain unchanged in the source assets.
export const BUILTIN_SUBUNIT_REVISION = 'builtin-subunits-2';
const relationships = {
  JEY: { basis: 'crown-dependency', note: '왕실속령. 영국의 일반 행정구역과 구분합니다.' },
  GGY: { basis: 'crown-dependency', note: '왕실속령. 영국의 일반 행정구역과 구분합니다.' },
  IMN: { basis: 'crown-dependency', note: '왕실속령. 영국의 일반 행정구역과 구분합니다.' },
  SXM: { basis: 'kingdom-constituent', note: '네덜란드 왕국 구성국.' },
  CUW: { basis: 'kingdom-constituent', note: '네덜란드 왕국 구성국.' },
  ABW: { basis: 'kingdom-constituent', note: '네덜란드 왕국 구성국.' },
  IOT: { basis: 'source-snapshot', note: '기본 지도 기준 자료의 영국 소속을 유지합니다. 시점별 주권 관계는 별도 검토 대상입니다.' },
  FLK: { basis: 'source-control', note: '기본 지도 분류상 영국 아래에 표시합니다. 영유권 주장을 확정하는 표시는 아닙니다.' },
  WSB: { basis: 'sovereign-base-area', note: '영국 주권기지구역.' },
  ESB: { basis: 'sovereign-base-area', note: '영국 주권기지구역.' },
  USG: { basis: 'legal-belonging', controllerCountryId: 'USA', lesseeCountryId: 'USA', note: '쿠바 귀속. 미국의 통제·임차 관계는 법적 소속과 별도로 기록합니다.' },
  KAB: { basis: 'legal-belonging', lesseeCountryId: 'RUS', note: [
    '카자흐스탄 귀속. 러시아의 임차 관계는 법적 소속과 별도로 기록합니다.',
    '경계 출처: 카자흐스탄·러시아 바이코누르 임대협정의 공식 좌표와 시르다리야강 우안에 사용된 OpenStreetMap 파생 자료.',
    '© OpenStreetMap contributors · ODbL 1.0 · https://www.openstreetmap.org/copyright',
    '원본·파생 데이터: https://github.com/kimjeon-il/PandoLab-library-data/blob/0b080946cda3c9150ac07693b6c5b03951313027/reports/geography/ne-selected-20261023/odbl-source-and-derivative.zip',
    '임대협정: https://old.adilet.zan.kz/rus/docs/U950002195_',
    '표시 경계는 약 1km 수준으로 일반화한 파생본이며, 법적 측량선으로 확정하지 않았습니다.',
  ].join('\n') },
};

// Current-map attribution: only the Baikonur lease geometry and Kazakhstan's
// shared edge use the OSM-derived riverbank line. Do not credit OSM for the rest
// of Kazakhstan's Natural Earth geometry or for historical reference shapes.
export function appendBaikonurBoundaryAttribution(notes, sourceCountryId) {
  const sourceId = String(sourceCountryId || '');
  if (sourceId !== 'KAB' && sourceId !== 'KAZ') return String(notes || '');
  const original = String(notes || '');
  const archive = 'https://github.com/kimjeon-il/PandoLab-library-data/blob/0b080946cda3c9150ac07693b6c5b03951313027/reports/geography/ne-selected-20261023/odbl-source-and-derivative.zip';
  if (original.includes(archive)) return original;
  const scope = sourceId === 'KAB'
    ? '바이코누르 임대구역 경계: 공식 임대협정 좌표와 시르다리야강 우안 OpenStreetMap 파생 자료.'
    : '바이코누르와 접하는 카자흐스탄 경계 일부: 공식 임대협정 좌표와 시르다리야강 우안 OpenStreetMap 파생 자료.';
  return [original, [
    scope,
    '© OpenStreetMap contributors · ODbL 1.0 · https://www.openstreetmap.org/copyright',
    '원본·파생 데이터: ' + archive,
    '공식 협정: https://old.adilet.zan.kz/rus/docs/U950002195_',
    '약 1km 수준으로 일반화한 표시용 경계이며, 법적 측량선으로 확정하지 않았습니다.',
  ].join('\n')].filter(Boolean).join('\n\n');
}

// UUIDv8 application namespace, stable across loads, preview/canonical and Undo.
export const builtinSubunitId = sourceId => `d34b00a1-9b13-8000-8000-000000${[...sourceId].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;
export const BUILTIN_SUBUNITS = Object.freeze([
  ['MAF', 'FRA'], ['SXM', 'NLD'], ['GIB', 'GBR'], ['HKG', 'CHN'], ['GRL', 'DNK'],
  ['NCL', 'FRA'], ['CUW', 'NLD'], ['ABW', 'NLD'], ['TCA', 'GBR'], ['SPM', 'FRA'],
  ['PCN', 'GBR'], ['PYF', 'FRA'], ['ATF', 'FRA'], ['UMI', 'USA'], ['MSR', 'GBR'],
  ['VIR', 'USA'], ['BLM', 'FRA'], ['PRI', 'USA'], ['AIA', 'GBR'], ['VGB', 'GBR'],
  ['CYM', 'GBR'], ['BMU', 'GBR'], ['HMD', 'AUS'], ['SHN', 'GBR'], ['JEY', 'GBR'],
  ['GGY', 'GBR'], ['IMN', 'GBR'], ['FRO', 'DNK'], ['IOT', 'GBR'], ['NFK', 'AUS'],
  ['WLF', 'FRA'], ['SGS', 'GBR'], ['FLK', 'GBR'], ['ASM', 'USA'], ['GUM', 'USA'],
  ['MNP', 'USA'], ['MAC', 'CHN'], ['ALD', 'FIN'], ['IOA', 'AUS'], ['CSI', 'AUS'],
  ['CLP', 'FRA'], ['ATC', 'AUS'], ['ESB', 'GBR'], ['WSB', 'GBR'], ['USG', 'CUB'],
  ['KAB', 'KAZ'], ['PGA', 'USA'],
].map(([sourceCountryId, parentId]) => Object.freeze({
  sourceCountryId, parentId, id: builtinSubunitId(sourceCountryId),
  ...relationships[sourceCountryId],
})));
const bySource = new Map(BUILTIN_SUBUNITS.map(row => [row.sourceCountryId, row]));
const byId = new Map(BUILTIN_SUBUNITS.map(row => [row.id, row]));

export function builtinSubunitSourceId(feature) {
  const row = byId.get(String(feature?.id || ''));
  return (feature?.properties?.entityKind === 'general' && !!feature?.properties?.parentId)
    && feature.properties.metadata?.builtinSubunit?.sourceCountryId === row?.sourceCountryId ? row?.sourceCountryId || '' : '';
}

/** Derived scene/label ID. Logical entity IDs remain unchanged. */
export function territorialSceneDisplayId(feature, countryIds) {
  const type = feature.properties?.entityKind;
  if (type === 'general' && !feature.properties.parentId) return String(feature.id);
  const sourceId = builtinSubunitSourceId(feature);
  return sourceId && !countryIds.has(sourceId) ? sourceId : `territorial:entity:${feature.id}`;
}

/** Only call for fresh built-in projects. Never a project-file migration. */
export function classifyBuiltinCountries(collection) {
  const features = collection?.features || [];
  const ids = new Set(features.map(feature => String(feature.id)));
  for (const row of BUILTIN_SUBUNITS) {
    if (!ids.has(row.sourceCountryId) || !ids.has(row.parentId)) throw new Error(`기본 하위단위 원본/부모 누락: ${row.sourceCountryId} → ${row.parentId}`);
  }
  const countries = [], subunits = [];
  for (const feature of features) {
    const row = bySource.get(String(feature.id));
    if (!row) {
      if (String(feature.id) === 'KAZ') {
        // Only the shared edge with the Baikonur lease has OSM-derived detail.
        // The remaining Kazakhstan geometry is not attributed to OSM.
        countries.push({ ...feature, properties: {
          ...feature.properties,
          notes: appendBaikonurBoundaryAttribution(feature.properties?.notes, 'KAZ'),
        } });
      } else {
        countries.push(feature);
      }
      continue;
    }
    subunits.push(createTerritorialFeature({
      id: row.id, entityKind: 'general', name: feature.properties.name, geometry: feature.geometry,
      parentId: row.parentId, coverageMode: 'explicit',
      notes: row.sourceCountryId === 'KAB' ? appendBaikonurBoundaryAttribution(row.note, 'KAB') : row.note || '',
      metadata: {
        builtinSubunit: { revision: BUILTIN_SUBUNIT_REVISION, sourceCountryId: row.sourceCountryId,
          relationshipBasis: row.basis || 'default-map-belonging',
          ...(row.controllerCountryId ? { controllerCountryId: row.controllerCountryId } : {}),
          ...(row.lesseeCountryId ? { lesseeCountryId: row.lesseeCountryId } : {}),
        },
        sourceCountryProperties: structuredClone(feature.properties),
      },
    }));
  }
  return { countries: mergeBuiltinTerritories({ ...collection, features: countries }), subunits };
}
