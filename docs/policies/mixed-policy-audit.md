# 추가 조사 — 정책이 다른 문서에 섞인 경우 (2026-11-11)

**브랜치:** `work/ui`. 정책 원문·실행 계산·외부 GIS 자료를 재배치하지 않고, 실제 규칙이 섞인 위치를 찾아 **현행 소유자 / 단계별 설계·검증 증거**를 구분하였다.

## 1. 현행 경로 정리

| 기존 문서 | 새 안내와 처리 |
| --- | --- |
| [작업공간 배치](../workspace-layout.md) | `src/` 단일 Viewer 구조로 현행 참조를 정리; 옛 `apps/viewer`·`apps/editor`·`shared/core` 배치표와 명령은 역사 자료로 보존 |
| [원격 개발 P1](../development/remote-development.md) | 폐기 Windows 검수기 설명과 없어진 `apps/editor/README.md` 링크를 더 이상 현행 지시로 취급하지 않음 |
| [앱 리팩터링 인벤토리](../architecture/app-refactor-inventory.md) | 삭제된 `platform-boundaries.md`, 구형 `app.js` 대신 현재 Viewer 모듈 소유자 안내; Phase 06 원문 보존 |
| [공통 Core 명령](../architecture/shared-core-command-boundary.md) | 옛 `shared/core` 대신 `src/document/native/` 기준 정본 명시; 이전 앱 입력·검증은 과거 기록으로 한정 |
| [객체 UI Registry](../architecture/ui-object-registry.md) | 현행 `src/document/map-object-categories.js` 소유권과 이전 Action Registry/편집 UI 설계를 구분 |
| [Map Toolkit 연결](../reference-map-plugin.md) | 독립 Windows 제품이 폐기된 현재 Web Viewer로 제품 설명 갱신 |
| [DEM·raster](../terrain-dem.md) | 실제 `dem-relief-v1` 자료/프로젝트 경로와 2026-10 raster 전환·성능 기록 분리 |
| [Worker RPC](../architecture/worker-rpc.md) | `src/runtime/worker-rpc.js`·호스트 소스와 생성·배포된 `assets/js/` URL을 구분 |

## 2. 다른 문서에 포함된 규칙을 연결한 위치

| 주제 | 규칙이 있던 문서 | 중앙 탐색 페이지 |
| --- | --- | --- |
| 도시 ID·명칭·실효일·승인 여부 | [대량 지명 검수](../place-batch-pipeline.md) | [도시·지명](places.md) |
| 수계 형상·존속 기간과 특정 호수 표시 | [강·호수 기간](../hydro-timeline.md) | [객체·시간축](objects-time.md), [GIS](gis.md) |
| GPKG·문서 저장·복구·원본 ID | [프로젝트 파일 호환성](../project-persistence-compatibility.md) | [객체·시간축](objects-time.md), [자료](data-projects.md) |
| 기타 형상 fallback·출처 보존 | [Generic Feature](../architecture/generic-feature-provenance.md) | [객체·시간축](objects-time.md) |
| 리소스 검증·게시 원자성 | [생성물 계약](../development/generated-artifacts-p2.md) | [개발](development.md), [자료](data-projects.md) |
| 호버·선택 표시 우선순위 | [지도 강조](../interaction-emphasis.md) | [지도 표시](map-rendering.md), [UI](ui.md) |
| 렌더러 자원·위상·fallback | [Renderer v2](../architecture/renderer-v2.md) | [지도 표시](map-rendering.md) |
| 로컬 원본·생성물·정리 및 중단 복구 | [상설 워크트리 저장](../worktree-storage.md), [드라이브 유지 관리](../c-drive-maintenance.md) | [개발](development.md) |
| 필수 테스트의 전제 조건과 책임 | [렌더링 검사 정리](../validation/rendering-unit-contract-ownership.md) 및 [기타 검증 소유권](validation.md) | [검증](validation.md) |
| 데이터 조사·출력 안전성 | [세계 자료 부분 조회](../world-data-inspection.md) | [GIS](gis.md), [자료](data-projects.md) |
| 실제 성능 수치·진단 임계값 | [성능 진단](../performance-diagnostics.md) | [지도 표시](map-rendering.md) |

## 3. 검사 확장

- 기존 `scripts/check-policy-links.mjs`는 현행 `docs/policies/*.md`와 직접 연결된 원본 문서의 Markdown 상대 링크·검증 그룹·npm 명령을 **실패 조건**으로 검사한다.
- 확장 검사에서는 **전체 `docs/**/*.md` 및 루트 안내 Markdown**을 읽는다. 중앙 정책에 연결되지 않은 옛 단계별 기록의 깨진 링크, 삭제된 코드 경로 표현, 규범적 문장 후보는 *진단*한다. 역사 기록의 URL/소스가 없다는 이유로 조용히 삭제·복원하거나 현재 제품 검사를 실패 처리하지 않는다.
- `node scripts/check-policy-links.mjs --strict-all`은 전체 문서의 미해결 경로를 엄격하게 검사하기 위한 수동 감사 모드다. 평소 CI는 현재 정책과 연결된 계약에 대해 실패를 판정한다.
- `scripts/contracts/application-checks.json`의 기존 `policy-links` 그룹은 `docs/**` 외에 `src/**`·`tools/**`·`config/**`·`contracts/**`·`projects/**` 및 CI 경로 변경에도 선택되도록 하여 **코드 소유자 이동 시 문서 참조가 방치되지 않게** 한다.

## 보존과 검증 한계

과거 결정·테스트 실패/성공·원본 SHA·스테이징 자료를 변경하거나 파일을 옮기지 않았다. 이 단계는 **현행 문서의 경로 정돈 및 진단 범위 확대**이지 전체 저장소의 모든 설계 결정을 현재 생산 규칙으로 승격하는 작업이 아니다.

새 검사기는 Markdown 경로·등록된 계약·규범 문구 후보를 식별하지만 원본 데이터 정확도, HTML 앵커·외부 URL, 코드의 실제 호출 의미, 지리 사실과 역사적 국가 지위를 증명하지는 못한다. 스키마·기간·렌더링 동작은 별도의 집중 검사와 실제 실행 증거가 필요하다.
