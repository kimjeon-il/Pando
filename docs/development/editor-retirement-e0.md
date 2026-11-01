# E0 — 그래픽 편집기 개발 동결 및 분리 기준 (2026-11-02)

> 상태: E0 조사·동결 기준 기록. **런타임 코드, 지도 데이터, 스키마, 빌드·배포 경로는 변경하지 않는다.**
> 대상: `work/ui`. 후속 작업: E1 공통 지도 읽기 경계 독립화.
> 이 문서는 개발 계약·의존성 목록이며, 실행 테스트 성적서나 GIS 조사 보고서는 아니다.

## 1. 즉시 적용할 개발 동결

- 마우스/터치 정점 조작, 국경/해안선 직접 그리기, 스냅, 드래프트, 도형 병합·분할, 편집 전용 입력 UI의 **신규 기능 개발·기능 확장 중단**.
- 기존 코드와 사용자의 자료를 삭제하거나 비활성화하지 않는다. E1~E5 동안 현재 동작은 보존하고, E6에서 새 검수 사용 경로가 검증된 후 전용 구현을 정리한다.
- 허용: 보안·무결성·충돌 수정, 공통 지도 열람 기능 개선, E1~E7 전환에 필요한 구조 분리·검수 시스템 개발, 기존 동작을 유지하는 결함 수정.
- 새로운 객체/레이어/프로젝트 이력 저장소를 병렬로 추가하지 않는다. 프로젝트, 선택, 렌더링의 기존 canonical owner를 재사용한다.
- 개발 동결은 정책이며 이 단계에서 CI의 필수 검사나 제품 런타임 기능을 강제로 차단하지 않는다.

## 2. 코드·자료 기준점 (조사 당시)

| 항목 | 식별자 / 사실 |
| --- | --- |
| 앱 저장소 | `kimjeon-il/Pando` |
| UI 기준 브랜치/커밋 | `work/ui` · `22926a0c2390e5f26dc60bb837edd77af26f1609` |
| GIS 비교 브랜치/커밋 | `work/gis` · `583c9fff499279cefc7b109d98199efa40bf307a` |
| 공통 조상 | `6017ea6c931b93f9075e02ed0c43dd771dd45b79` |
| 두 작업 브랜치 관계 | GIS 대비 UI 43커밋 앞섬/96커밋 뒤처짐, diverged. 상호 병합을 뜻하지 않음 |
| 데이터 저장소 | `kimjeon-il/PandoLab-library-data` |
| 양쪽 `config/library-data.json` 데이터 pin | `5eb7be55208efaafe39bd5a65ec2f111d70b9053` (조사 시점 동일) |
| 현재 앱 프로젝트 형식 | `apps/editor/README.md` 기준 schema 13; 구형 schema 12 자동 복원·변환 금지 |
| 이전 원본 | 기존 `kimjeon-il/PandoEditor` 복구 근거 유지 (`docs/branch-policy.md`) |

**주의:** 위 pin이 같다는 사실은 UI/GIS 브랜치의 애플리케이션 코드가 동등하다는 뜻이 아니다. E1 이후 병합·데이터 변경은 별도 승인 범위이며, 이 문서는 어떤 브랜치도 병합·재설정하지 않는다. 원격 소스 열람으로 조사했으므로 상설 로컬 워크트리의 미커밋 상태는 확인하지 못했다.

## 3. 실제 실행 책임 구조

`apps/viewer/js/modules/viewer-composition.js` (읽기 전용 웹 제품)와 `apps/editor/frontend/js/modules/app-composition.js` (현재 Windows/Android 편집 제품)가 서로 다른 진입점이다. 양쪽은 `shared/frontend/js/modules/map-owner-composition.js` 등 공통 owner, C++ 문서 read model, WebGL/Canvas 지도 렌더러를 공유한다.

`apps/editor/frontend/js/modules/app-domain-assembly.js`가 ProjectDomain/SelectionDomain/GisDomain/EditingDomain/RenderingDomain을 묶는다. 이 조합은 프로젝트 교체·선택 변경 때 EditingDomain을 호출한다. `apps/editor/frontend/js/modules/app-project-restore.js`도 프로젝트 초기화/불러오기에서 편집 제스처 취소 및 EditingDomain 리셋에 의존한다. `apps/editor/frontend/js/modules/app-gis-assembly.js`는 GIS import 계획의 적용 시 `editingDomain.commitImport`를 사용한다.

공통 `rendering-domain.js`는 지도/선택 렌더링과 함께 선택적으로 `editingRenderResources`, `getEditingRenderPacket`, editPresentation 및 정점·드래프트·검증 오버레이를 지원한다. 편집 렌더 경계가 선택적이더라도 공통 코드에서 호출이 남으므로 무조건 파일 삭제하면 안 된다. `map-owner-composition.js`는 이미 `editing=null`을 받아 읽기 전용으로 구성할 수 있으며, viewer 모드에서 편집 훅이 전달되면 예외를 던진다.

**제품 정책 위험:** `shared/frontend/js/modules/product-mode-policy.js`는 viewer를 globe, editor를 flat 투영으로 제한한다. `resource-capabilities.js`도 제품별 globe/terrain 지원이 다르다. 따라서 네이티브 app에서 `viewer` 모드만 강제하는 단순 대체는 불가하다. E1은 '읽기 전용' 권한과 '평면/지구본 및 플랫폼' 지원을 독립적으로 정의해야 하며, 현재의 정상 지도 열람 동작을 잃지 않아야 한다.

## 4. 분류 및 인수인계 대상

### A — 절대 보존할 핵심 (읽기 및 데이터 정합성)

| 코드/영역 | 이유 |
| --- | --- |
| `shared/frontend/js/modules/map-owner-composition.js` | 웹·네이티브 공통 지도 owner |
| `shared/frontend/js/modules/rendering-domain.js`의 읽기/선택 부분 및 GPU/Canvas 모듈 | 지도 렌더링, 렌더 캐시 및 무효화 |
| `shared/frontend/js/modules/project-domain.js`, `selection-domain.js` | Core 문서와 canonical 선택/프로젝트 명령 |
| `shared/frontend/js/modules/timeline-resolver.js`, `timeline-records.js`, `temporal.js` | 역사 시점별 지도 조회 및 C++ 계산 |
| `shared/frontend/js/modules/project-state.js`, `project-file-reader.js` | 현재 지원 프로젝트 형식 검증 및 열기 |
| `shared/frontend/js/modules/geometry-validation.js`, `source-provenance.js` | GIS 무결성 검증, 출처 메타데이터 |
| `shared/core`, `shared/wasm`에서 사용 중인 Core 모델·시간축·검증·렌더 지원 | 런타임 공유 계산과 직결; 이름이 'edit'여도 사용처 확인 전 삭제 금지 |
| `apps/editor/native-platform-adapter.js`, `document-transfer-contract.js` 및 Rust Tauri transport | Windows/Android 파일 선택·전송, 보안 경계 |

### B — 분리 전 삭제 금지 (공통/편집 혼합)

| 코드/영역 | 확인한 결합 | E1/E4 방향 |
| --- | --- | --- |
| `apps/editor/frontend/js/modules/app-domain-assembly.js` | EditingDomain+프로젝트 복구+선택+렌더 | 읽기 전용 조합에서 편집 의존성 격리 |
| `apps/editor/frontend/js/modules/app-composition.js` | 편집 owner와 지도 owner 초기화 일원화 | 공통 읽기 owner/제품 조합 분리 |
| `apps/editor/frontend/js/modules/app-project-restore.js` | import/reset에서 편집 취소·리셋 | 읽기용 프로젝트 복원 분리 |
| `apps/editor/frontend/js/modules/app-gis-assembly.js` | GIS 계획과 `commitImport` 경로 결합 | 검사/조회/내보내기와 변이 적용 분리 |
| `apps/editor/frontend/js/modules/app-history-assembly.js`, `app-project-snapshots.js` | 문서 Undo/Redo, autosave, view restore 혼합 | 보기 상태·프로젝트 I/O 보존 범위 파악 |
| `shared/frontend/js/modules/project-session.js` | 보기 상태와 편집 상태 혼합 | canonical viewing state 보존, 편집 전용만 제거 |
| `shared/frontend/js/modules/file-access-contract.js` | viewer/editor별 요구 메서드 구분 | read/검수 요구사항 재정의 시 native file picker 보존 |
| `apps/editor/frontend/js/modules/project-serializer.js` | 현재 프로젝트 형식/지문 | 지원 중인 schema 13 기준 유지, 불필요한 migration 금지 |
| `apps/editor/templates/index.html`, `shared/frontend/css/components/editor-shell.css` | 도구/선택/상태 및 편집 전용 UI 혼재 | 화면 전환 확인 후 정리 |

### C — 삭제 후보 (E6 전 미삭제)

- `apps/editor/frontend/js/modules/editing-domain.js`: 도구·제스처·정점·드래프트·선택 편집 이력.
- `editing-presentation.js`, `editing-render-packet.js`, `edit-preview-controller.js`, `geometry-snap.js`, `draft-stroke.js`: 직접 편집 상호작용·시각화.
- `map-edit-worker-client.js`, `apps/editor/frontend/js/workers/map-edit-worker.js` 및 `map-edit-*`: 현재 소비자가 편집 전용인지 E1에서 참조 역추적 필수. 공통 형상 계산과 중복되지 않는 기능은 보존.
- `app-country-commits.js`, `app-territorial-drafts.js`, `app-territory-selection-workflow.js`, `territorial-library-editing-ui.js` 및 직접 작성 UI: 검수 대체 경로 마련 후 제거 후보.
- 편집 전용 테스트, P8 editor 워크플로, DOM 검사 계약: E6에서 코드와 함께 동기화. 필요 검증을 먼저 대체한다.

### D — 검수 화면에서 재사용할 기능

- 객체 선택/검색: `selection-domain.js`, `object-query.js`, `object-search-controller.js`.
- 검증: `geometry-validation.js`, C++ topology/geometry verification.
- 시간·속성·출처: `timeline-resolver.js`, `project-state.js`, `source-provenance.js`.
- 웹/네이티브 공통화: `map-owner-composition.js`, `platform-ports.js`, `file-access-contract.js`.
- 새로운 Git 리비전 비교·검수 상태는 **기존 canonical data의 외부 메타데이터/CI 산출물**로 구성하며 별도의 두 번째 프로젝트 모델을 만들지 않는다.

## 5. 테스트/CI 기준선과 빈틈

- UI 기준 커밋의 GitHub Actions `P1` run 41358342152, `P3` run 41358342170은 전체 run의 결론이 success. **그러나 P1은 plan/native-plan만 실행, P3는 plan만 실행했다.** native-core, WASM 빌드, browser-regression 등 실질 검증 작업은 skipped. 따라서 'E0에서 화면·네이티브 회귀 테스트 통과'라고 판정하지 않는다.
- 별도 이 로컬 세션에는 상설 `work/ui` 워크트리와 의존성 캐시가 없으므로 `pnpm`, Playwright, C++/Rust 및 실기기 테스트는 실행하지 않았다. GitHub 원격 코드·트리·CI 기록만 조사했다.
- E1 필수 정적 검사: `node scripts/check-runtime-boundaries.mjs`, `pnpm check:architecture`, `pnpm check:ui`. 기존 checker는 `editing-domain.js` export, `editorSurface` 존재 등을 전제로 하므로 E6 이전 임의 수정 금지.
- E1 집중 단위 테스트: `tests/unit/domain-split-contract.test.mjs`, `application-composition.test.mjs`, `shared-map-composition.test.mjs`, `file-access-contract.test.mjs`, `project-state.test.mjs`, `project-serializer.test.mjs`, `timeline-resolver.test.mjs`, `native-document-transfer-contract.test.mjs`.
- E1 이상 브라우저 검사: `tests/browser/viewer-project-open.spec.mjs`, `viewer-layout.spec.mjs`, `shared-map-parity.spec.mjs`, `selection-domain-smoke.spec.mjs`, `editing-state-recovery.spec.mjs`. 이 중 편집 전용 테스트는 E4까지 이전 동작 확인용으로 유지.
- E4/E7 실기기 확인: Windows 네이티브, Android ARM64, 평면 지도 보기, 현재 지원 프로젝트 열기, 시간축, 국명·국기·관계, GIS 검사·파일 읽기. 브라우저 에뮬레이션은 실기기 검증의 대체가 아니다.
- `scripts/contracts/application-checks.json`의 영향 기반 테스트 계획과 `scripts/check-ui-information-architecture.mjs`, `scripts/check-runtime-boundaries.mjs`는 E6의 기존 DOM/편집 경계 제거와 **같은 변경 범위**에서 갱신해야 한다.

## 6. E1 작업 시작 조건과 완료 게이트

1. UI/GIS work branch를 무단 병합하지 않는다. GitHub 비교와 data pin을 갱신해 교차 오염 여부를 먼저 판단한다.
2. 공통 map owner, Core document, temporal read model 및 렌더 캐시를 단일 canonical 소유자로 유지한다.
3. 기존 viewer와 editor에서 읽기/렌더가 정상 동작하는 회귀 기준을 **실제로 실행**해 남긴다. 계획 job 성공을 실행 결과로 대체하지 않는다.
4. E1은 `app-domain-assembly.js`, `app-project-restore.js`, `app-gis-assembly.js`, `rendering-domain.js`의 편집 의존성을 줄이되 기존 app 사용자 동작을 유지한다.
5. read-only 권한과 투영/리소스 지원을 별개로 설계한다. 네이티브 평면 지도 제거·제품 형식 혼동 금지.
6. 선택·시간축·객체 조회·파일 가져오기·기존 지원 schema 13·native IPC의 회귀 검사 통과 후에만 E1 완료 판정.
7. E1~E5 동안 기능 제거와 사용자 설정 초기화를 하지 않는다. 삭제는 E6, 최종 통합 점검은 E7.

## 7. E0 경계

이 단계에서는 도형·국기·국명·GIS 데이터·연도별 기록을 수정하지 않으며, `config/library-data.json` pin, 프로젝트 schema, Core/WASM, 동작/DOM, 앱 빌드 및 CI 구성을 바꾸지 않는다. `main` 통합, 웹 배포, Windows/Android 패키징도 하지 않는다. E0의 산출물은 이 계약과 `apps/editor/AGENTS.md`의 범위 제한, `apps/editor/README.md`의 안내에 한정한다.
