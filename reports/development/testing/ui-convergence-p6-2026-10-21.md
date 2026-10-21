# UI 구조 통일 P6 — 공통 구조 정리·최소 회귀 검증

> 보고서 ID: `UI-CONVERGENCE-P6-20261021` · 상태: `focused-unit-browser-app-stage-verified / native-webview-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-21  
> 원문 최종 수정: 2026-10-21  
> 코드 조사 기준: `work/ui` `7f1cad96333a2f81bc68e8ef22a3fdefba8fc18d` (P5 이후), P6 `4f80c53`, 최종 생성물 `4df41af`  
> 수정 범위: 본 P6 커밋의 6개 소스·테스트 파일, 보고서와 색인. `main`에 직접 반영하거나 배포하지 않음.  
> 근거: [P0 조사](ui-convergence-p0-audit-2026-10-20.md) · [P4 보고](ui-convergence-p4-2026-10-21.md) · [P5 보고](ui-convergence-p5-2026-10-21.md)

## 범위

사용자 지시에 따라 전체 테스트 스위트 대신 변경된 UI 구조와 보정 도구에 직접 관련된 검사만 선정했다. 기존 P0에서 확인한 9개 사례의 최종 소스 구조를 재검토했다.

| P0 사례 | P6 점검 결과 |
| --- | --- |
| U01 객체 컨텍스트 메뉴 | 공통 `ui-menu` 항목 사용 확인. 신규 변경 없음 |
| U02 새 프로젝트 창 | 네이티브 `dialog` 내부의 `ui-dialog-card` 및 `ui-field` 사용 확인. 신규 변경 없음 |
| U03 환경설정 포커스 | 환경설정 모듈이 별도 Tab 순환을 갖지 않는 구조 확인. 신규 변경 없음 |
| U04 검색 패널 | `search-toolbar-presentation.js`의 DOM 재부모화 경로 부재 확인. 신규 변경 없음 |
| U05 휴대전화 가로 | 기존 분리된 Layout·Surface 규칙 유지. 신규 변경 없음 |
| U06 삭제 버튼 | `object-property-controller.js`의 삭제 섹션 DOM 이동 경로 부재 확인. 신규 변경 없음 |
| U07 편집 HUD | 원래 inspector slot의 부모를 검사하고 표시 상태만 갱신. 포인터 보호는 패널 전환 중 지도 드래그를 지키는 정상 동작이어서 유지 |
| U08 참조 이미지 패널 | factory 시점 완성된 공통 `header/body/footer`, 단일 workspace 부모와 지연 스타일 규칙 유지 |
| U09 선 보강·자동 추적 | P5 고정 Action footer 유지. 불필요한 요약 영역 MutationObserver와 과거 버튼 이동 전용 CSS 선택자 제거. **탭 전환 후 버튼이 갱신되지 않는 결함을 수정** |

## 확인된 회귀와 수정

P5의 시작 버튼 활성 상태는 각 도구의 `syncUi()`가 `[data-ref-section="match"]`의 `hidden`을 읽어 결정한다. 그런데 편집기 `setEditorTab()`은 하위 section의 `hidden`만 갱신하며, 각 도구의 MutationObserver는 편집기 루트와 직접적인 `childList`만 관찰한다. 따라서 최초 `placement` 상태에서 `match`를 눌러도 버튼 상태를 갱신할 이벤트가 없었다.

- `reference-image-controller.js`: 탭 클릭·키보드 탐색 모두 거치는 `setEditorTab()`에서 `reference-image-tab-changed` CustomEvent를 한 번 발행한다.
- `reference-image-line-refine-controller.js`, `reference-image-live-wire-controller.js`: 해당 이벤트로 기존 `scheduleSync()`를 호출하고, 종료 때 리스너를 제거한다. 작업 상태·명령·저장·지도 계산은 바꾸지 않았다.
- 더 이상 버튼을 요약↔본문으로 옮기지 않으므로 양쪽 컨트롤러의 `.reference-image-editing-summary` 관찰을 제거했다. `editor` 전체 subtree를 감시하면 `setMessage()`의 textContent 쓰기가 불필요한 재동기화를 일으킬 수 있으므로 관찰 범위를 넓히지 않았다.
- `layout/reference-images.css`: 과거 footer 직계 `reference-image-calibration-actions`의 미사용 스타일 두 곳을 제거했다. 새 footer Action 자식 선택자는 보존했다.
- 단위 검사는 양쪽 시작 버튼의 `placement → match → placement` 표시 상태 전환과 동일 버튼 보존을 추가했다. 기존 모바일 브라우저 시나리오에는 탭 클릭 및 왼쪽 화살표 키보드 전환을 추가했다.

## 단계별 최소 검증 결과

| 항목 | 결과 | 정확한 실행 범위 |
| --- | --- | --- |
| 1차 ESLint·Node 단위 | **25/25 통과**, ESLint 통과 | `reference-image-surface.test.mjs`, `reference-image-ui.test.mjs`, 관련 소스/테스트 8개 ESLint. [실제 CI 실행](https://github.com/kimjeon-il/Pando/actions/runs/39572335246) |
| 2차 UI 구조·CSS 계층 | **모두 통과** | `node scripts/check-ui-architecture.mjs` (Surface 1 계약·CSS 30개·legacy ratchet 4), `node scripts/check-ui-layering.mjs` (정본 CSS 25개). 동일 CI 실행 |
| 3차 Playwright | **총 5/5 통과** | [최초 실행](https://github.com/kimjeon-il/Pando/actions/runs/39571774395)에서 모바일 보조 UI 2건 통과, 기존 선 보강·자동 추적 3건은 최초 진입 전에 지연 API가 있다고 가정하여 실패. 테스트 준비 순서만 수정한 뒤 [재검사](https://github.com/kimjeon-il/Pando/actions/runs/39572335246)에서 3/3 통과 |
| 4차 지연 CSS 앱 스테이징 계약 | **1/1 통과** | 기존 `apps/web-shell/tests/stage.test.mjs`의 참조 CSS catalog 전수 검사. 생성용 fixture 환경 테스트 |
| 4차 실제 앱 `small-project` 스테이징 | **통과** | [실제 CI](https://github.com/kimjeon-il/Pando/actions/runs/39573489751): 정식 생성기 실행 후 1,134파일·62,473,993바이트, 참조 이미지 JS/CSS 9개 소스 바이트 동일, `check-stage.mjs` 통과. [메타데이터 게시 CI](https://github.com/kimjeon-il/Pando/actions/runs/39573901604)에서 동일 경로 재검증 |
| Windows Tauri·Android 실제 WebView | **미실행** | 소스 브라우저 테스트와 Linux `small-project` stage 검증은 네이티브 WebView 기동 검증을 대체하지 않음 |
| `pnpm check:ui` 전체·무관 GIS/Worker 테스트 | **요청에 따라 생략** | 수정 범위 관련 검사만 수행. [별도 GIS P2 실패](https://github.com/kimjeon-il/Pando/actions/runs/39558398760)는 `Invalid prepared polygon mesh: boundary edge`이며 이 UI 검증 결과와 무관 |

### 회귀 진단 및 변경 내용

브라우저의 세 실패는 `reference-image-line-refine.spec.mjs`와 `reference-image-live-wire.spec.mjs`의 `waitForReady`가 기능을 열기 **이전**에 `__PANDOLAB_REFERENCE_IMAGES__.open` 존재를 요구한 테스트 전제 때문이었다. 기존 P4의 실제 지연 초기화 정책에 맞춰 런처 클릭 후 API를 기다리도록 `4fe5dcb`에서 수정했고, 실패했던 세 시나리오만 재실행했다. 애플리케이션 보정 계산·저장·명령 코드는 건드리지 않았다.

CI 첫 실제 스테이징은 `assets/js/build-meta.js`의 이전 생성 결과와 현행 소스가 달라 `Stale build metadata output`에서 중단됐다. 그 결과를 무시하거나 검사를 약화하지 않고 정식 `scripts/generate-build-metadata.mjs`를 실행했다. 작업 checkout에서 변경된 파일은 `index.html`, `apps/web-shell/editor.html`, `assets/js/build-meta.js` 정확히 세 개뿐이었다. 생성 전후 앱 검증을 마치고 허용된 세 파일만 [`work/ui` 커밋 `4df41af`](https://github.com/kimjeon-il/Pando/commit/4df41af2ce1dd4ed5e5586f11432800841f41225)에 반영했다. 그 외 원본 GIS·지도·저장 파일은 수정하지 않았다.


## 산출물·릴리스 상태와 잔여 항목

`reference-images.css`는 지연 로딩 스타일 정본 catalog에서 계속 관리한다. `index.html`, 앱 editor HTML, JS 빌드 메타데이터는 **정식 생성기로 갱신한 세 파일**만 기록됐다. `main` 병합·웹 게시·네이티브 앱 배포는 이 단계에서 하지 않았다.

실제로 수행한 최소 검증 명령은 다음과 같다.

```bash
pnpm exec eslint assets/js/modules/reference-image-{controller,surface,surface-port,ui,line-refine-controller,live-wire-controller}.js tests/unit/reference-image-surface.test.mjs tests/browser/reference-image-auxiliary-surface.spec.mjs
node --test tests/unit/reference-image-surface.test.mjs tests/unit/reference-image-ui.test.mjs
node scripts/check-ui-architecture.mjs
node scripts/check-ui-layering.mjs
pnpm exec playwright test tests/browser/reference-image-auxiliary-surface.spec.mjs tests/browser/reference-image-line-refine.spec.mjs tests/browser/reference-image-live-wire.spec.mjs --workers=1 --retries=0 --trace off
node scripts/generate-build-metadata.mjs
node scripts/generate-build-metadata.mjs --check
node apps/web-shell/stage.mjs --profile=small-project
node apps/web-shell/check-stage.mjs
```

네이티브 Windows Tauri·Android 기동 확인은 미실행이며, 현재 UI 단위·브라우저·app staging 검사 통과라는 범위와 구분해야 한다. `work/ui`의 변경을 `main`에 병합하거나 배포하려면 별도 지시가 필요하다.
