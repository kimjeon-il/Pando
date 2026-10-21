# UI 구조 통일 P6 — 공통 구조 정리·최소 회귀 검증

> 보고서 ID: `UI-CONVERGENCE-P6-20261021` · 상태: `cleanup-implemented / isolated-focused-verified / browser-native-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-21  
> 원문 최종 수정: 2026-10-21  
> 코드 조사 기준: `work/ui` `7f1cad96333a2f81bc68e8ef22a3fdefba8fc18d` (P5 이후)  
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

## 최소 검증 결과

| 항목 | 결과 | 정확한 실행 범위 |
| --- | --- | --- |
| 변경 파일 구문 | **8개 소스·테스트 파서 검사 통과** | 실제 GitHub 파일 본문을 V8에서 파싱하되 ESM import/export를 검사 환경에 맞춰 제거 |
| Surface·도구 관련 단위 시나리오 | **10/10 통과** | 기존 `reference-image-surface.test.mjs`의 테스트 함수, 실제 모듈 본문을 사용한 V8 모의 DOM 실행. 외부 의존성은 검사용 stub으로 대체 |
| 탭 전환·키보드 동작 집중 시나리오 | **7/7 통과** | `setEditorTab()`과 `onEditorTabKeydown()`의 실제 소스·모의 탭 DOM으로 이벤트·표시·포커스 검사 |
| P0~P5 구조·재부모화 정적 점검 | 확인 완료 | GitHub `work/ui` 소스에서 대표 이동 패턴과 공통 소유자 규칙 점검. 런타임 동등성 보증은 아님 |
| `node --test`, Playwright, `pnpm check:ui` | **미실행** | 현재 환경에 실제 저장소 checkout 및 브라우저 빌드 실행 환경이 없어 정식 검사 결과를 주장하지 않음 |
| 실제 Tauri WebView 및 앱 staging | **미실행** | 참조 모듈의 자산 경로는 P4와 동일하며 앱 stage는 `assets/` 트리를 복사하지만 P6 실행 검증은 별도 필요 |

`work/ui`의 P5 커밋에 대한 기존 원격 자동화는 UI 집중 검사와 다르다. [P3 원격 검증](https://github.com/kimjeon-il/Pando/actions/runs/39558398807)의 선택 단계는 성공했으나 실제 브라우저 검증 job은 skip되었다. [P2 산출물 자동화](https://github.com/kimjeon-il/Pando/actions/runs/39558398760)는 GIS prepared polygon mesh의 `Invalid prepared polygon mesh: boundary edge`로 실패했다. 본 UI 수정의 성공·실패로 환산하지 않으며 P6에서 GIS를 수정하지 않았다.

## 산출물·릴리스 상태와 남은 검증

공용 JS 모듈 경로와 CSS 자산 목록은 바뀌지 않았고 `reference-images.css`는 공통 정본에 등록된 지연 로딩 파일이다. `index.html`, 앱 editor HTML, JS 빌드 메타데이터는 생성물이며 이번 작업에서는 직접 손대지 않았다. 릴리스 전에 정식 생성기에서 현재 리비전으로 갱신·검증해야 한다. 이번 보고서는 새 빌드 ID나 캐시 갱신을 검증했다고 주장하지 않는다.

실제 완료 판정을 위한 최소 후속 실행은 다음과 같다. 전체 GIS·Worker·네이티브 계산 스위트는 불필요하다.

```bash
node --test tests/unit/reference-image-surface.test.mjs
node scripts/check-ui-architecture.mjs
node scripts/check-ui-layering.mjs
pnpm exec playwright test tests/browser/reference-image-auxiliary-surface.spec.mjs --workers=1
# 앱 빌드 출력이 필요한 경우: 앱 stage small-project 자산 정합성 검사
```

단위·브라우저 결과를 확보하지 못한 항목은 미검증으로 남긴다. Windows Tauri 네이티브 WebView는 이 환경에서 실행되지 않았다. `main` 병합·게시·배포는 이 단계에 포함하지 않는다.
