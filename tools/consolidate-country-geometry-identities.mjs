
/**
 * One-time, guarded consolidation of three pilot "historical countries" into
 * geometry versions of their existing current-country identities.
 *
 * Intended for work/objects only. This migration never manufactures
 * intermediate boundary coverage; it keeps the existing modern reference
 * date as the first supported modern geometry date.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), value);
const json = relative => JSON.parse(read(relative));
const save = (relative, value) => write(relative, JSON.stringify(value, null, 2) + '\n');

function patch(file, before, after) {
  const source = read(file);
  assert.equal(source.split(before).length, 2, 'Expected exactly one patch anchor in ' + file);
  write(file, source.replace(before, after));
}
function replaceAll(file, before, after) {
  const source = read(file);
  assert.ok(source.includes(before), 'Missing expected reference in ' + file);
  write(file, source.split(before).join(after));
}

const snapshot = json('assets/data/territorial-entities/source/snapshots/current-world.json');
assert.equal(snapshot.referenceDate, '2026-10-06');
const mapping = [
  ['indonesia', 'state:IDN', 'state:indonesia', '2002-05-19'],
  ['ukraine', 'state:UKR', 'state:ukraine', '2014-03-17'],
  ['sudan', 'state:SDN', 'state:sudan', '2011-07-08'],
];
for (const [lineage, canonicalId, historicalId, expectedEnd] of mapping) {
  const file = 'assets/data/territorial-entities/source/countries/' + lineage + '.json';
  const source = json(file);
  assert.equal(source.lineageId, lineage);
  const modern = source.entities.find(item => item.entityId === canonicalId);
  const historical = source.entities.find(item => item.entityId === historicalId);
  assert.ok(modern && historical, 'Expected distinct modern and historical entries: ' + lineage);
  assert.equal(modern.geometryVersions.length, 1);
  assert.equal(historical.geometryVersions.length, 1);
  assert.deepEqual(modern.lifetime, {validFrom:null, validTo:null});
  assert.equal(historical.lifetime.validTo, expectedEnd);
  assert.deepEqual(modern.geometryVersions[0].validFrom, null);
  assert.deepEqual(modern.geometryVersions[0].validTo, null);
  assert.equal(historical.instantiation.mode, 'territory-replacement');
  const earlier = structuredClone(historical.geometryVersions[0]);
  earlier.instantiation = structuredClone(historical.instantiation);
  earlier.historicalProvenance = {
    originalEntityId: historicalId,
    sourceInfo: structuredClone(historical.sourceInfo),
    metadata: structuredClone(historical.metadata),
  };
  const current = structuredClone(modern.geometryVersions[0]);
  current.validFrom = snapshot.referenceDate;
  current.validTo = null;
  modern.lifetime = {validFrom:historical.lifetime.validFrom, validTo:null};
  modern.geometryVersions = [earlier, current];
  source.entities = source.entities.filter(item => item !== historical);
  assert.equal(source.entities.filter(item => item.entityId === canonicalId).length, 1);
  assert.equal(source.entities.some(item => item.entityId === historicalId), false);
  save(file, source);
  const obsolete = path.join(root, 'assets/data/territorial-entities/generated/v2/' + historicalId.replace(':','-') + '.json.gz');
  assert.ok(fs.existsSync(obsolete), 'Expected generated obsolete chunk: ' + historicalId);
  fs.unlinkSync(obsolete);
}
const policyPath = 'assets/data/historical-world/policy.json';
const policy = json(policyPath);
const oldRule = policy.replacements.find(row => row.priorityEntityId === 'state:ukraine');
assert.ok(oldRule && oldRule.basis.sourceEntityId === 'state:ukraine');
oldRule.priorityEntityId = 'state:UKR';
oldRule.basis.sourceEntityId = 'state:UKR';
save(policyPath, policy);

// A geometry-version selection may need a territory-replacement command even
// when the modern geometry of that same country is an independent selection.
patch('assets/js/modules/territorial-library.js',
  'instantiation: structuredClone(entity.instantiation),',
  'instantiation: structuredClone(version.instantiation || entity.instantiation),');

// Qt/native descriptors must select the same version-local policy.
patch('native/app/territoriallibrarycatalog.cpp',
  'metadata["sourceInfo"]=entity.value("sourceInfo");metadata["sourceLifetime"]=entity.value("lifetime");',
  'metadata["sourceInfo"]=entity.value("sourceInfo");metadata["sourceLifetime"]=entity.value("lifetime");\n        if(version.contains("historicalProvenance"))metadata["historicalProvenance"]=version.value("historicalProvenance");');
patch('native/app/territoriallibrarycatalog.cpp',
  '{"metadata",metadata},{"instantiation",entity.value("instantiation")}',
  '{"metadata",metadata},{"instantiation",version.contains("instantiation")?version.value("instantiation"):entity.value("instantiation")}');

// The historical world compiler must preserve one project ID across several
// geometry windows of current-snapshot entities, with genuine gaps retained.
const compiler = 'tools/historical-world-timeline.mjs';
patch(compiler,
  'definitions.set(feature.id, { identity: normalized, currentSnapshot: true, info, windows: [{ ...interval,\n      versionId: version.versionId, geometry: feature.geometry, parentId: feature.properties.parentId,\n      coverageMode: feature.properties.coverageMode }] });',
  'const historicalWindows = primary.geometryVersions.filter(row => row.versionId !== version.versionId).map(row => {\n      const historicalInterval = intersection(lifetime, bounds(row));\n      return historicalInterval && { ...historicalInterval, versionId: row.versionId, geometry: row.geometry,\n        parentId: feature.properties.parentId, coverageMode: feature.properties.coverageMode, currentSnapshot: false };\n    }).filter(Boolean);\n    definitions.set(feature.id, { identity: normalized, currentSnapshot: true, info, windows: [\n      ...historicalWindows, { ...interval, versionId: version.versionId, geometry: feature.geometry,\n        parentId: feature.properties.parentId, coverageMode: feature.properties.coverageMode, currentSnapshot: true }\n    ] });');
patch(compiler,
  'currentSnapshot: definition.currentSnapshot,',
  'currentSnapshot: active[0].currentSnapshot ?? definition.currentSnapshot,');
patch(compiler,
  'const adjusted = adjustHistoricalTerritories(candidates, policy, clipper);',
  'const mappedPolicy = { ...policy, replacements: policy.replacements.map(rule => ({ ...rule,\n      targetEntityId: sourceToProject.get(rule.targetEntityId) || rule.targetEntityId,\n      priorityEntityId: sourceToProject.get(rule.priorityEntityId) || rule.priorityEntityId,\n    })) };\n    const adjusted = adjustHistoricalTerritories(candidates, mappedPolicy, clipper);');

// Check a historical geometry/version, not the parent entity mode.
const validator = 'scripts/check-territorial-library.mjs';
for(const [_,canonicalId,historicalId] of mapping) replaceAll(validator, "id: '" + historicalId + "',", "id: '" + canonicalId + "',");
patch(validator,
  "if (definition.entityKind !== 'general' || !!definition.parentEntityId || definition.instantiation?.mode !== 'territory-replacement') {",
  "if (definition.entityKind !== 'general' || !!definition.parentEntityId) {");
patch(validator,
  "if (!version) throw new Error(`\u0024{check.id} geometry version is missing: \u0024{expectedVersion.id}`);",
  "if (!version) throw new Error(`\u0024{check.id} geometry version is missing: \u0024{expectedVersion.id}`);\n    if ((version.instantiation || definition.instantiation)?.mode !== 'territory-replacement') throw new Error(`\u0024{expectedVersion.id}: historical version must replace transferred territory`);");

const publicationTest = 'tests/unit/historical-world-publication.test.mjs';
replaceAll(publicationTest, "'state:ukraine'", "'UKR'");
patch(publicationTest,
  "assert.equal(october.points[0].rootIds.join(), 'UKR');",
  "assert.equal(october.points[0].rootIds.join(), 'UKR');\n  assert.equal(october.entities.find(row => row.entityId === 'UKR').sourceEntityId, 'state:UKR');\n  assert.equal(trace.months.find(row => row.month === manifest.sourceMonth).entities.find(row => row.entityId === 'UKR').sourceEntityId, 'state:UKR');");
for(const file of [
  'native/tests/historical_world_timeline_tests.cpp',
  'native/tests/historical_world_ui_tests.cpp',
  'tests/browser/historical-world-timeline.spec.mjs',
]) {
  const content = read(file);
  if(content.includes('state:ukraine')) replaceAll(file, 'state:ukraine', 'UKR');
}

// The frozen 284-object fixture remains an immutable *pre-migration* oracle.
// Current catalog must have 281 identities and the same 287 shape versions.
const baselineTest = `import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {readTerritorialSources} from '../../tools/territorial-entity-sources.mjs';
const baseline=JSON.parse(fs.readFileSync(new URL('../fixtures/country-lineage-baseline.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const merged={'state:IDN':'state:indonesia','state:UKR':'state:ukraine','state:SDN':'state:sudan'};
test('consolidation preserves all 287 geometry versions and the three historical shape fingerprints',()=>{
 const entities=readTerritorialSources();
 assert.equal(entities.length,281);
 assert.equal(new Set(entities.map(e=>e.lineageId)).size,262);
 assert.equal(entities.reduce((n,e)=>n+e.geometryVersions.length,0),287);
 for(const removed of Object.values(merged))assert.ok(!entities.some(e=>e.entityId===removed));
 for(const entity of entities){
  const expected=baseline.entities[entity.entityId];assert.ok(expected,entity.entityId);
  assert.equal(entity.lineageId,baseline.membership[entity.entityId]);
  assert.equal(entity.parentEntityId,expected.parentEntityId);
  assert.equal(sha(entity.sourceInfo),expected.sourceInfoHash);
  assert.deepEqual(entity.names,expected.names);
  assert.deepEqual(entity.alternateNames,[...new Set([...expected.alternateNames,...(!Object.values(expected.names).includes(expected.canonicalName)?[expected.canonicalName]:[])])]);
  const old=merged[entity.entityId];
  if(!old){
   assert.deepEqual(entity.lifetime,expected.lifetime);
   assert.deepEqual(entity.geometryVersions.map(v=>({versionId:v.versionId,validFrom:v.validFrom,validTo:v.validTo,geometryHash:sha(v.geometry)})),expected.versions);
   continue;
  }
  const prior=baseline.entities[old],historical=entity.geometryVersions[0],current=entity.geometryVersions[1];
  assert.deepEqual(entity.lifetime,{validFrom:prior.lifetime.validFrom,validTo:null});
  assert.deepEqual({versionId:historical.versionId,validFrom:historical.validFrom,validTo:historical.validTo,geometryHash:sha(historical.geometry)},prior.versions[0]);
  assert.deepEqual({versionId:current.versionId,geometryHash:sha(current.geometry)},{versionId:expected.versions[0].versionId,geometryHash:expected.versions[0].geometryHash});
  assert.equal(current.validFrom,'2026-10-06');assert.equal(current.validTo,null);
  assert.equal(historical.instantiation.mode,'territory-replacement');
  assert.equal(historical.historicalProvenance.originalEntityId,old);
 }
});
`;
write('tests/unit/country-lineage-preservation.test.mjs',baselineTest);

// Record this intentionally narrow operation with no newly invented boundaries.
const report = `# 역사 형상 중복 정체성 정리 — 인도네시아·우크라이나·수단

> 보고서 ID: \`GEO-LIFE-002\` · 상태: \`investigating\` · 지도 반영: \`not-applied\` (main 미반영)
> 작업 기준: 2026-10-13 · \`work/objects\` / 2026-10-06 현행 세계 스냅샷

## 목적
역사 영토 샘플을 국가 자체의 별도 entity로 등록했던 세 사례를 하나의 현대 국가 entity와 복수 \`geometryVersions\`로 결합한다. 기존 현대 ID \`state:IDN\`, \`state:UKR\`, \`state:SDN\`을 유지하고 역사 원본 ID \`state:indonesia\`, \`state:ukraine\`, \`state:sudan\`은 삭제한다. 이전 각 역사 버전의 ID, 좌표, 유효기간 및 출처는 같은 형상 버전 안에 보존한다.

| 보존할 객체 | 역사 형상 구간 | 현대 형상 증거 시작 | 확인되지 않은 중간 구간 |
| --- | --- | --- | --- |
| \`state:IDN\` | 1945-08-17~2002-05-19 | 2026-10-06 | 2002-05-20~2026-10-05 |
| \`state:UKR\` | 1991-08-24~2014-03-17 | 2026-10-06 | 2014-03-18~2026-10-05 |
| \`state:SDN\` | 1956-01-01~2011-07-08 | 2026-10-06 | 2011-07-09~2026-10-05 |

세 '역사 형상 구간'은 기존의 대략적 지리 복원자료를 그대로 옮긴 것이지, 모든 해당 일자의 정밀 국경 검증 완료를 뜻하지 않는다. 국가 정체성의 lifetime은 연속하지만, 사용 가능한 geometry는 비연속일 수 있다.

## 구현 검증 항목
- entity 284 → 281, 국가계보 262 유지, 형상 버전 287 유지.
- 역사 시점에도 현대 ID의 객체를 선택하고 근거 없는 중간 날짜에는 과거/현대 형상이 대신 표시되지 않음.
- 원래 역사 형상과 현대 형상의 좌표가 그대로 보존되고, 앱·웹 역사 선택의 영토 교체 방식도 유지됨.
- GitHub Pages와 main 자동 병합/배포 없음. 생성된 웹 및 native 데이터의 해시·동등성 검사는 실제 실행 성공 시에만 인정.
`;
write('reports/geography/country-geometry-identity-consolidation-2026-10-13.md',report);
const reports='reports/README.md';
patch(reports,
  '| `GEO-023` | [Verified entity lifetime additions]',
  '| `GEO-LIFE-002` | [역사 형상 중복 정체성 정리 — 인도네시아·우크라이나·수단](geography/country-geometry-identity-consolidation-2026-10-13.md) | 2026-10-13 | `investigating` | `not-applied` |\n| `GEO-023` | [Verified entity lifetime additions]');

console.log('Staged 3 canonical entities, 6 historical/current geometry versions and focused contract changes.');
