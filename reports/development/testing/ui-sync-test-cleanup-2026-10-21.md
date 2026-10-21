# UI 작업 상태 복원과 폐기된 테스트 정리

> 보고서 ID: `UI-SYNC-CLEANUP-20261021` · 상태: `local-focused-verified / unpublished / native-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-21  
> 원문 최종 수정: 2026-10-21  
> 수정 기준: Web/App 공통 `work/ui` 커밋 `7f1cad96333a2f81bc68e8ef22a3fdefba8fc18d` + 미커밋 변경  
> 근거: [브랜치 정책](../../../docs/branch-policy.md), [P5 원래 구현 기록](ui-convergence-p5-2026-10-21.md), 아래 로컬 백업·검사 로그

## 동기화와 보존

기존 로컬 HEAD `d8d424d70584a7336e2a85351c1a3d684377e3f0`에서 원격 `work/ui`의 `7f1cad96`까지 fast-forward했다. 현재 `main`의 `6fc982bf`가 포함되며, 그 위의 원격 P5 UI 변경도 보존한다. 이번 수정·정리는 main 병합, push, 배포를 수행하지 않았다.

사용자가 승인한 임시 보존본은 `D:/dev/release-evidence/PandoLab/ui-main-sync/d8d424d7-20261021/`에 있다. 원래 존재했던 972개 파일의 127,085,081바이트를 복사하고 SHA-256을 대조했으며, 원래 테스트 삭제 상태는 `tracked.patch`와 유지한 stash `2f30668c77588b5f1fb823de3f5de81a527f2837`에 남아 있다. stash를 pop/drop하지 않았다.

- 원래 수정된 자동 생성 permission 6개는 백업과 동일한 바이트로 복원했다.
- 예전 GIS 파생 파일 12개와 미추적 생성 캐시 954개는 외부 백업에 보존했다. 새로운 국가별 builtin-world/LSIB 자료를 예전 파생본으로 덮어쓰지 않았다. 원본 GIS 입력이나 수작업 형상 변경은 없었다.
- 원래 873개 테스트 삭제를 일괄 적용하지 않았다. 이후 사용자가 승인한 불필요 테스트 정리에 따라 아래 21개만 제거하고 현재 회귀·자료·CI 검사는 유지했다. 작업 전 삭제 상태도 백업에서 복구 가능하다.
- 테스트 원본 21개는 `removed-tests/`에 복사·해시 대조 후 제거했다. `cleanup-manifest.json`에 경로·크기·SHA-256·보존 방식을 기록했다.

## 실제 UI 수정

P5의 버튼 이동 제거 후 ‘맞추기’ 탭을 켜도 선 보강/자동 추적 시작 버튼이 숨겨진 상태로 남는 문제를 실제 브라우저에서 재현했다. 두 도구의 MutationObserver가 editor 자체만 감시하고, 탭 내부 section의 `hidden` 변경을 감지하지 못했다.

두 컨트롤러에서 section 하위 변경을 감시하되, 상태 문구·도구 출력에 따른 갱신은 필터링했다. 버튼 표시와 명령의 소유자는 기존 Surface/도구 컨트롤러에 유지한다. 기존 단위 테스트도 실제 MutationRecord 형태와 탭 전환을 반영했다. 브라우저 테스트의 원본 이미지 바이트 비교·취소·미리보기·고정 버튼 identity 검사는 유지했다.

## 테스트 정리 기준과 남긴 검사

정리 대상은 삭제된 `app-spatial-index.js`, `app-object-picking.js`, `app-workspace-surfaces.js`, `app-project-session.js`를 읽거나, Web viewer 루트에 편집기 DOM이 있다는 가정, schema 10, 과거 UI 문자열·CSS 배치를 고정하는 버전별 Python 검사다. 현재 구현을 되돌리거나 assertion을 느슨하게 바꿔 통과시키지 않고 폐기된 검사를 제거했다.

현재 계약은 `versioning-source-schema`, `core-product-mode`, `project-state`, `task-stage-presentation`, `workspace-layout`, `object-property-controller`, `object-search-controller`, `object-deletion-async-command`, `file-menu-routes` 등의 단위 검사와 `editor-workspace`, `workspace-surfaces`, `shell-file-save`, `gis-interchange` 등의 브라우저 검사에서 유지된다. 이 정리는 해당 검사들을 전부 다시 실행했다는 뜻은 아니다. 소스 문자열 검사의 모든 옛 assertion이 행동 검사와 일대일 대응한다고 주장하지 않는다.

폰트 원본 해시·라이선스 검사는 실제 자산 검증이므로 `tests/test_font_assets.py`로 분리해 보존했다. GIS 형상, 모델 동작, 수계, import/export, 현재 기능 회귀 검사와 fixtures/helpers는 유지했다. 수동 CI·성능 baseline에서 참조하는 Soviet 메모리·CPU 진단도 유지했다. 파일 이름에 버전이나 날짜가 있다는 이유만으로 삭제하지 않았다.

정리 후 단위 테스트 파일 492개, 브라우저 spec 164개가 남아 있다. 제거한 파일에 대한 실행 코드·테스트·workflow·script의 명시적 참조는 발견되지 않았다. Python unittest 자동 탐색에서는 삭제된 파일이 자연스럽게 제외된다.

### 제거한 파일

- `tests/test_v0125_runtime.py`
- `tests/test_v0140_ui_flows.py`
- `tests/test_v0150_typography_copy.py`
- `tests/test_v0151_control_styles.py`
- `tests/test_v0160_responsive_ui.py`
- `tests/test_v0163_editor_layout.py`
- `tests/test_v0164_mobile_status.py`
- `tests/test_v0170_information_hierarchy.py`
- `tests/test_v0171_alignment.py`
- `tests/test_v0180_ui_system.py`
- `tests/test_v0181_editor_chrome.py`
- `tests/test_v0182_task_dock.py`
- `tests/test_v0190_editor_system.py`
- `tests/test_v0191_status_layout.py`
- `tests/test_v0192_layer_controls.py`
- `tests/test_v0240_layer_item_deletion.py`
- `tests/test_v0302_shell_file_save.py`
- `tests/test_v0303_object_editor.py`
- `tests/test_v0304_map_editing_tools.py`
- `tests/test_v0307_current_schema.py`
- `tests/test_v0312_layer_style_capabilities.py`

## 실행한 검증과 한계

로그 위치: `build-native/ui-main-sync-20261021/` (고정 로컬 검사 경로, Git 제외).

| 검사 | 결과 | 범위·한계 |
| --- | --- | --- |
| 기존 Surface/UI/workflow 단위 검사 3개 파일 | 35/35 통과 | P5 동기화 직후 기준, `focused-tests.log` |
| 수정 후 Surface 단위 검사 | 10/10 통과 | 두 도구의 탭 전환과 상태 문구 갱신 필터 포함, `surface-after.log` |
| 참조 이미지 보조 도구 브라우저 검사 | 최종 2/2 통과 | 편집기 HTML, 390×844 CSS px, 선 보강·자동 추적의 시작/실제 미리보기/패널 확장/취소/원본 이미지 보존, `browser-after.log` |
| 폰트 자산 검사 | 1/1 통과 | 원본 파일 SHA-256 및 라이선스 |
| 변경 컨트롤러 Node 구문 검사 | 통과 | 2개 모듈 |
| UI bundle / HTML import map·build metadata 생성 | 성공 | 현재 P5 모듈과 수정 소스로 재생성 |
| 삭제 대상의 명시적 호출 참조·Git 충돌 상태 | 참조 없음 / unmerged 없음 / staged 없음 | 원래 WIP와 정리 결과는 미커밋 상태 |
| 전체 테스트·전체 아키텍처 검사 | 미실행 | 사용자 요청에 따라 불필요한 전수 실행 제외 |
| 앱 staging·Windows/Android 실제 WebView | 미실행 | 브라우저 편집기 결과를 native 검증으로 간주하지 않음 |
| main 통합·배포 | 미실행 | 현재 work/ui 로컬 변경 |

초기 브라우저 실행은 숨겨진 시작 버튼에서 실패했고, subtree 감시 범위를 조정하는 중간 실행은 중단했다. 위 통과 수치는 최종 실행 로그에 한한다. native에서의 이미지 적용·저장·Undo 전체 흐름은 이번 검사 범위에 없다. GIS 형상이나 역사 경계 정밀도 검사는 실행하지 않았다.
