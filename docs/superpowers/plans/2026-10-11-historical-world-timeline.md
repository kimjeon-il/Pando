# 기본 세계 역사 타임라인 — 당시 구현 계획(축약)

> 2026년 승인·실행 단계의 역사적 계획. 현행 소스·[승인된 설계 사양](../specs/2026-10-11-historical-world-timeline-design.md) 및 고정 검사 근거가 우선한다. [축약 전 단계별 계획 전문](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/docs/superpowers/plans/2026-10-11-historical-world-timeline.md).

## Global Constraints

- 우크라이나만 연결하지 않고 현재 역사 라이브러리의 전체 자료를 연결한다.
- 선택한 시점에 유효한 경계 자료가 없는 국가는 숨긴다. 현대 경계나 가장 가까운 연도의 경계로 채우지 않는다.
- 커서 `YYYY-MM`은 해당 달의 마지막 날이다. 시작과 종료는 양끝 포함이다.
- 현대 스냅샷은 원본 기준일이 속한 한 달에만 기본 지도의 자료로 제공한다. 현재 자료에서는 `2026-10`이다.
- 원본 수명·형상 기간·기준일·정밀도·출처·확실성은 provenance에 보존한다. 파생 구간은 원본과 구별한다.
- 웹 산출물은 현재 프로젝트 schema 10, timeline records/storage schema 1이다. 앱의 현재 네이티브 저장 형식은 유지한다.
- 같은 라이브러리 객체의 형상 버전이 바뀌어도 논리 ID는 유지한다. 커서 이동 때 새 UUID를 생성하지 않는다.
- 날짜 이동은 view만 변경하며 dirty·Undo 항목·canonical 기록을 변경하지 않는다.
- 수동 라이브러리 추가·빈 프로젝트·기존 저장 프로젝트의 복원 계약은 유지한다. 마이그레이션이나 새 역사 자료 조사는 추가하지 않는다.
- 웹과 앱의 `work/objects` 상설 워크트리를 사용한다. main 통합·배포는 별도 지시가 필요하다.

## Review Focus

1. 기본 세계 자료 로드 중 새 프로젝트/복원 요청이 발생하면 오래된 응답이 새 세션을 덮어쓰지 않아야 한다. Task 3의 세대 전환 테스트로 고정한다.
2. 하위 영토에만 경계가 있거나 부모가 중간에 사라지면 해당 구간의 하위 영토도 숨겨야 한다. Task 1의 부모 공백 테스트로 고정한다.
3. 최초 선택 월이 현대 기준 월과 다르면 현대 미리보기 없이 빈 영토 상태로 시작할 수 있어야 한다. Tasks 3/5의 초기 월 테스트로 고정한다.
4. 캐시에 손상된 압축 자료가 있거나 해시가 다르면 검증 실패가 전달되고 정상 자료로 재시도할 수 있어야 한다. Tasks 3/4의 실패 테스트로 고정한다.
5. 저장된 형상이 현대 기본 ID를 유지해도 좌표가 편집됐다면 현재 mesh로 대체하면 안 된다. Task 5의 기존 좌표 변조 회귀와 Task 6의 저장 왕복으로 고정한다.

## 파일과 책임

웹 경로 기준 루트는 `D:/dev/worktrees/web/objects`, 앱은 `D:/dev/worktrees/app/objects`다. 아래 Web/App 표기는 서로 다른 저장소를 뜻한다.

| 파일 | 책임 |
| --- | --- |
| Web `tools/historical-world-timeline.mjs` | 원본 기간과 ID를 기존 프로젝트 기록으로 컴파일하는 순수 함수 |
| Web `tools/historical-world-territories.mjs` | 명시적 대체·부모 자르기·미확정 동급 중첩 제거 |
| Web `assets/data/historical-world/policy.json` | 카탈로그 entity 목록과 분리한 영토 대체 선언 |
| Web `tools/build-historical-world-timeline.mjs` | 입력 읽기, 결정적 직렬화/압축, manifest/report 생성 및 `--check` |
| Web `assets/data/historical-world/generated/v1/` | 빌드 산출물이며 직접 편집하지 않음 |
| Web `assets/js/modules/historical-world-loader.js` | 기존 stored-asset-loader를 이용한 검증·로드, 새 mutable 세계 상태 없음 |
| Web 기존 builtin/startup/restore 모듈 | 전체 기록을 새 기본 프로젝트에 설치하고 정적 재분류 호출 제거 |
| App `tools/sync-historical-world-timeline.mjs` | 명시적 웹 경로에서 동일 산출물을 검증·미러링 |
| App `app/historicalworldtimeline.{h,cpp}` | 기존 importer 결과를 기본 세계의 ID/형상 참조로 변환하는 실제 경계 |
| App 기존 worlddataset/loader/bootstrap/controller | 리소스 로드, dated 문서 활성화, resolved view와 현재 mesh 연결 |
| 양쪽 집중 테스트 및 공통 expected trace | 시간·소속·형상·편집·저장·실제 화면 결과 검증 |

## 산출물 및 함수 계약

`compileHistoricalWorldTimeline({ entities, currentSnapshot, currentWorld, policy, clipper })`는 `{ project, coverageReport, sourceIdentities }`를 반환한다. `entities`는 `readTerritorialSources()`의 정규화된 원본, `currentWorld`는 `buildCurrentWorld()`의 원본 FeatureCollection이다. 프로젝트 내용은 기존 `createProjectSerializer`/`assertCurrentProjectSchema`와 timeline validator로 검증한다. 날짜 기록 생성은 기존 정적 사본 생성 함수의 무기한 기록을 그대로 재사용하지 않는다.

`adjustHistoricalTerritories(candidates, policy, clipper)`는 같은 정확한 날짜 구간의 `{ entityId, parentId, geometry }[]`를 받아 `{ candidates, adjustments }`를 반환한다. 부모 및 원본 geometry를 변경하지 않는다. clipper는 저장소에 이미 포함된 polygon-clipping API이며 새 패키지를 설치하지 않는다.

산출물은 `world-project.json.gz`, `coverage-report.json`, `expected-trace.json`, `manifest.json`이다. manifest schemaVersion은 내부 버전 `1`이며 `sourceMonth`, `inputHashes`, `sourceIdentities`, `project`/`coverageReport`/`expectedTrace` asset spec을 가진다. asset spec은 `{url, encoding, compressedBytes, decodedBytes, sha256}`이며 sha256은 저장 바이트의 해시다. `sourceIdentities` 행은 `{projectEntityId, sourceEntityIds, sourceFeatureIds, currentGeometryRef}`다. 역사 객체에는 `sourceFeatureIds: []`, `currentGeometryRef: null`을 사용한다. manifest 외의 기록 출처는 객체 metadata에 원본 entity/version 및 날짜를 보존한다. 프로젝트 루트에 비표준 필드를 넣지 않는다.

`createHistoricalWorldLoader({ manifestUrl, manifestSpec, dataRevision, fetchFn, cacheStorage }).loadProject()`는 `{ project, manifest }`를 반환한다. 로드는 immutable 입력 준비이고 프로젝트 활성화는 기존 store/transaction 경계가 소유한다. 공통 decoded project 크기 제한은 기존 앱 importer의 64 MiB 제한 이내로 유지하며 빌드 때 확인한다.

policy는 `{schemaVersion: 1, unknownPeerOverlap: 'exclude-from-all', replacements: [...]}`이다. replacement 행은 `{targetEntityId, priorityEntityId, validFrom, validTo, basis: {sourceEntityId, geometryVersionIds}}`다. 소련을 target으로 하는 우크라이나와 나고르노카라바흐의 기간은 각각 `1991-08-24`~`2014-03-17`, `1991-09-02`~`2023-09-28`이며 실제 원본/형상 구간과 교집합으로 적용한다. 미참조 원본 version이나 원본 범위와 어긋난 정책은 빌드에서 거부한다.

## 과거 작업 단계 1~6 요약

1. 기존 기간·객체 identity를 compiler로 조립하고 원본 일자 정밀도·출처 보존
2. 부모·형상 중첩, 미제공 기간, 현대/역사 국토의 범위 판정과 생성물 출판
3. 웹 초기화·날짜 변경·기본지도 적용·손상/이전 응답 오류 경계 통합
4. 앱에 동일한 파일/manifest 고정, native 모델·저장 경계에서 기존 의미 유지
5. 앱 커서별 활성 world/mesh 재사용, 좌표 변경·비활성 형상 검증
6. 공통 날짜 trace·브라우저/Qt의 편집·Undo/저장·오프라인 복원을 직접 검증

[당시 검증 결과와 한계](https://github.com/kimjeon-il/PandoLab-library-data/blob/a09a1de5ee0e7fd6d6f8627c84f887068ca4eba9/reports/development/testing/historical-world-timeline-validation.md)를 참조. 별도 역사 자료 고증·실기기·전체 배포의 검증까지 완료했다고 이 계획만으로 판단하지 않는다.

원래 Task별 구현 파일 목록·실행 명령·회귀 항목과 리뷰 지시는 고정 Git 원문에 보존된다.
