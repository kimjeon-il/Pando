# P1 — 중복 규칙 통합·구형 참조 정리 결과 (2026-11-11)

> 대상: `kimjeon-il/Pando` 기존 상설 `work/ui`  
> P0 근거: [inventory.p0.json](inventory.p0.json), [P0 중앙 색인](README.md)  
> 현재 코드의 현행성과 역사 문서의 당시 효력을 구분한다. **제품 동작·외부 데이터 핀·스키마·이전 증거의 바이트를 변경하는 작업이 아니다.**

## 처리 원칙

1. **동일 규칙만 단일 정본으로 연결:** 앱 버전의 MINOR/PATCH·자료 버전 원칙은 [VERSIONING.md](../../VERSIONING.md), 구형 GIS URL 보존 원칙은 [docs/data-url-retention-policy.md](../data-url-retention-policy.md)에 둔다. 중복 기술은 역사 기록으로 구별하여 보존한다.
2. **각기 다른 정책은 통합하지 않음:** 장소 후보·검수 승인·5등급 표시·역사명·라벨 유효기간, 역사 영토 조사 임계값·동적 벡터 LOD, UI 공통 규격·컴포넌트 예외는 책임이 다르다.
3. **과거 기록의 사실·날짜·검사·SHA는 그대로:** P0 이전의 앱 분리/이전 스키마/미완료 표기는 당시 상태를 나타내도록 명시한다. 해당 코드를 재도입하거나 옛 검증을 현재 CI 통과로 재사용하지 않는다.
4. **실행 소유자 우선 확인:** 제품은 단일 Web Viewer, 기간 해석은 C++/WASM, 앱 버전 소스는 package.json, 프로젝트 버전 상수는 `src/runtime/version-contract.js`, 레코드는 `src/document/timeline-records.js`다.

## P0 검토 12건의 P1 처분

| P0 ID | 결정 | 실제 작업 |
| --- | --- | --- |
| P0-01 | 현행화 | [AGENTS.md](../../AGENTS.md)의 사라진 `assets/js/modules/resource-update-policy.js` 경로를 `src/runtime/resource-dependency-policy.js`(렌더 재내보내기 경로 병기)로 수정. 폐기 독립 앱 검증 문구 정리 |
| P0-02 | 현행화·이력 보존 | [지명 동기화 계약](../place-sync-contract.md)에 실제 `src/document/place-contract.js`·PLAC v3·지명 Worker/빌드 소유자를 제시. `apps/editor`와 v2/이식 표는 2026 당시 이력으로 별도 표시 |
| P0-03 | 현행화·이력 보존 | [타임라인 의미 계약](../timeline-contract.md)과 [영토 출처 계약](../territorial-source-contract.md)에 단일 Viewer/C++·프로젝트 14·레코드 3을 명시. Web/App 독립 브랜치 및 프로젝트 10/기록 1은 당시 이력 |
| P0-04 | **중복 정책 통합** | [버전·저장·교환](../architecture/versioning-migrations-exchange.md)의 버전 증분 지침을 [VERSIONING.md](../../VERSIONING.md)로 일원화. 원본 버전 서술은 역사 부록에 그대로 보존. 현재 버전 상수 경로·스키마 수정 |
| P0-05 | **중복 정책 통합** | 현행 [URL 정본](../data-url-retention-policy.md)과 [2026-10-09 정책 변경 이력](../validation/data-versioning-phase11-policy.md)을 분리. 최초 삭제 승인 범위·당시 보존 대상 및 검사 조건 보존 |
| P0-06 | 규정·증거 구별 | [지도 표시](../architecture/map-visual-policy.md) M4~M7 실행 기록과 [지명](../place-runtime.md) 단계별 검증 기록의 날짜/현재 소유자를 상단에 명시. 증거를 통째로 다른 위치에 복제하지 않음 |
| P0-07 | **통합하지 않음** | [국경 복원](../historical-border-reconstruction-policy.md)의 사건 조사·1:10M 선별과 [LOD](../architecture/map-rendering-lod-p0-p1.md)의 표시 파생 규칙은 책임이 다름. 옛 앱 적용 범위만 현행 제품으로 수정 |
| P0-08 | **통합하지 않음** | 지명 5등급 표시의 실제 계산은 [place-display-rank.mjs](../../tools/build/place-display-rank.mjs), 후보는 [geonames-policy.mjs](../../tools/lib/geonames-policy.mjs). 기본 인구 경계 100/50/20/10/5만 명과 잠정 공간 보정은 유지 |
| P0-09 | 과거 구조 경계 | [App UI 경계](../architecture/app-ui-boundaries.md)는 이전 편집 제품의 상세 원문을 보존하고, 현재 [Viewer 소유자](../app-module-ownership.md)와 `src/app/` 모듈로 안내. 별도 Windows/Tauri 제품을 현행 게이트로 간주하지 않음 |
| P0-10 | 계약·구현 단계 분리 | [프로젝트 데이터 소유권](../architecture/project-data-ownership.md)은 현행 기준, [프로젝트 0~2단계 이행](../architecture/map-project-data-ownership.md)은 2026-11-09 당시 구현 기록으로 표시 |
| P0-11 | 구형 편집 IA 분리 | [UI 정보구조](../architecture/ui-information-architecture.md)는 `추가/편집` 설계를 이전 제품의 의사결정으로 보존. 공통 UI 측정치는 [UI Architecture](../architecture/ui-architecture.md)와 [UI Components](../architecture/ui-components.md)를 따름 |
| P0-12 | 당시 실행 범위 표시 | [프로젝트 공통 LOD 계획](../architecture/project-common-lod-implementation.md)의 `work/gis` 전용·병합 금지 문구는 2026 당시 작업 범위로 한정. 현재 개발 제약은 [브랜치 정책](../branch-policy.md) 참고 |

## 추가로 수정한 구형 스키마·기준 설명

- [영토 객체 계약](../architecture/territorial-entity-contract.md): 현재 프로젝트 14 / 모델 6 / `timelineRecords` 3; 예전 13/2 및 2026 구현 단계는 역사 문맥으로 구분.
- [Timeline T2-1](../timeline-records.md): 당시의 '현재 schemaVersion 2' 설명을 2026-10-21 스냅샷으로 표기. 코드 정본은 레코드 3.
- [Timeline T2-2a](../timeline-storage.md) 및 [T2-2 영속성 검증](../timeline-persistence.md): 당시 미연결/프로젝트 9·10/Windows·App 테스트는 현재 미구현 또는 현재 검증으로 소급하지 않음.
- [상설 브랜치](../branch-policy.md), [AGENTS.md](../../AGENTS.md), [최상위 README](../../README.md): 현재 단일 Web Viewer 기준의 작업·출처 용어를 사용.
- [UI Architecture](../architecture/ui-architecture.md): 현재 사용 중인 공통 UI 수치·토큰은 유지, 구형 편집 Surface 설계는 역사 문맥으로 구분.

## 보존·검증 및 남은 경계

**보존:** 원본 정책의 의사결정 날짜·예외·분기별 조건, 이전 제품 비교/검증 결과, fixture 숫자·SHA·실패 기록 및 GPKG/별도 외부 보고서 원문을 삭제하지 않았다. 구조화된 P0 원장 `inventory.p0.json`은 당시 311개 경로 기준선 그대로 남긴다.

**수정하지 않음:** `src/`의 실행 코드, `scripts/` 검사 실행기, `config/`·`contracts/`·`.github/workflows/` 구성, 프로젝트 스키마, 외부 `PandoLab-library-data`, Git 기존 증거, `main` 및 Pages 게시물. 정책 파일 간 물리적 이동은 P2 이후 실제 링크·소유권 검토가 필요한 경우에만 고려한다.

**검증 수준:** 기존 상설 `work/ui`의 GitHub 원격 트리를 사용해 선별 문서·코드 버전/소유 경로를 확인했다. 변경한 정책·안내 Markdown **23개 파일**의 상대 링크 **183개**를 전수 경로 점검하여 존재하지 않는 대상 경로 **0개**를 확인했다. P0 원장 **311개 경로**의 기준선도 그대로 유지됐다. 전수 코드 실행·실제 브라우저·전체 CI, 로컬 작업트리의 미커밋 상태는 이 도구 경로에서 확인하지 않는다. 현재 동작·전체 코드 참조 도달성·모든 문서 198개의 내용 동등성을 전수 검증했다고 주장하지 않는다.

**P2에 남기는 내용:** 문서 위치 정규화, 아직 경로 기반 분류인 P0 문서의 실제 소유자 추가 검증, 색인·시스템 검사와의 연결, 과거 증거와 독립된 현행 정책 페이지의 필요성 평가. 기능 범위를 바꾸거나 새로운 대전략 지도 규칙을 제정하지 않는다.
