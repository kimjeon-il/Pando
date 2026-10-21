# objects 브랜치의 잔여 파일 정리

> 보고서 ID: `DEV-CLEANUP-OBJECTS-20261021` · 상태: `local-focused-verified / uncommitted / unpublished` · 지도 반영: `not-applicable` · 색인일: 2026-10-21  
> 원문 최종 수정: 2026-10-21  
> Web/App 공통 기준: `6fc982bfe1b3f13c0ce9988af0a73d1358f0be2b` + 이번 미커밋 정리 및 기존 작업 상태  
> 원본·근거: [정리·보관 목록](/D:/dev/release-evidence/PandoLab/branch-cleanup-20261021/objects-result.json), [작업 전 상태](/D:/dev/release-evidence/PandoLab/branch-cleanup-20261021/objects-preflight.json)

## 범위와 보관 방식

사용자가 승인한 상설 main·objects·gis·places 정리 계획을 적용했다. 필요한 완료 증거는 외부 보관하고, 재사용 빌드·SDK·의존성·앱 실행물·현재 자료·원본 지도/문헌·미완성 작업은 유지했다. 새 워크트리, stash/reset/clean, 커밋·push·통합·배포는 수행하지 않았다. UI 기능 수정은 다른 브랜치로 옮기지 않았다.

이 브랜치에서 **290개 항목**, **124,549,998바이트**를 작업 폴더에서 제거했다. 여기에는 구형 테스트 21개, 옛 Worker 실행 묶음의 파일 102개, 옛 세계지도 객체 22개와 완료된 진단·검증 자료 등이 포함된다. junction 항목은 링크 자체만 제거하고 공유 대상은 따라가지 않았다.

외부 보관소는 `D:/dev/release-evidence/PandoLab/branch-cleanup-20261021/`이다. `files/objects/`에 원래 경로를 유지하고 각 파일을 SHA-256으로 검증했다. 동일 내용은 외부 보관소 안에서만 hardlink로 중복 제거했으며, 작업 파일과 보관본을 hardlink로 연결하지 않았다. 링크는 대상 경로를 목록에 기록했다. 결과 JSON에는 파일별 크기·SHA-256·제거 사유·원래 위치가 남아 있다. 소스 수정 전 판본은 `source-before/`, 보고서 수정 전 바이트는 `modified-files-before/`에 있다. 이는 작업 폴더 정리량이며 디스크 전체 순증가·순감소량을 뜻하지 않는다.

## 생성 자산 목록 수정

현재 world manifest에 없는 옛 객체 18개가 P2 검증 기록의 디렉터리 전체 출력 목록에 남아 있었다. 사용자가 목록 수정까지 승인했다.

- 기존 생성 자산 소유자인 `scripts/lib/p2-artifact-graph.mjs`와 graph 설정에서 world-bundle 출력 범위를 **현재 manifest 및 현재 자산 5개**로 제한했다. 옛 객체를 모두 출력으로 간주하는 디렉터리 선택을 제거했다.
- 기존 staging의 검증 기록 작성 코드를 `recordArtifactReceipts`로 모아 같은 소유자가 기록하도록 했다. 선택한 family의 검증 완료 후 호출하며, 출력 누락 시 기록하지 않는다. unrelated family는 유지하고 미커밋 입력은 `sourceDirty: true`로 표시한다.
- 실제 world builder의 `--check`가 통과한 현재 데이터는 그대로 두고 world-bundle 기록만 정본 writer로 갱신했다. 다른 family의 기록은 전후 JSON 값이 같다. 지도 형상·국가 기간·WASM은 재생성하거나 변경하지 않았다.

## 테스트와 증거 정리

UI에서 이미 정리한 구형 테스트 21개와 내용이 같은 파일만 제거했다. 삭제된 모듈·옛 편집기 DOM·옛 스키마를 검사하던 버전별 source-text 검사다. 유효한 폰트 원본 해시·라이선스 검사는 `tests/test_font_assets.py`로 유지했다. 현재 모델·GIS·편집·Undo/Redo 회귀 검사와 CI가 참조하는 성능 진단은 제거하지 않았다.

완료된 로그·스크린샷·브라우저 결과·일회성 진단/구 앱 잔여물은 보관 후 제거했다. 실제 Markdown 링크는 외부 보관본으로 갱신했고, 역사적 설명·실행 명령은 과거 기록으로 유지하면서 보관 위치를 덧붙였다. 미완성 objects의 lifetime·predicate 작업 및 그 입력·실험 증거, 고정 CMake/WASM 빌드와 SDK/driver, GIS 원본 문헌·지도·DEM 원본은 보존했다.

## 실행한 검증

| 검증 | 결과와 범위 |
| --- | --- |
| 생성 자산 소유·검증 기록 갱신 및 기존 staging 회귀 | 선택한 **4/4 통과**. 새 동작 2개는 수정 전 실패를 확인했다. staging 실제 출력 검사·변경 없는 재생성 동작 포함 |
| Worker·제품 자산·세계지도 버전 검사 | **15/15 통과**. main에서 한 번 실행했고 네 브랜치의 해당 소스/테스트가 동일함을 확인해 중복 실행하지 않음 |
| 폰트 자산 검사 | **1/1 통과**. 네 브랜치의 폰트 바이트와 검사 소스, 개행을 제외한 라이선스 내용이 동일함을 확인 |
| 현재 지도 데이터 | 각 브랜치에서 world builder `--check` 통과. 현재 자산 5개. 이후 참조 자산 해시 불변 확인 |
| 현재 Web/App 참조 자산 | 이 브랜치 **195개** 해시가 작업 전과 동일 |
| 보호 대상 미커밋 파일 | 이 브랜치 **274개** 작업 전 해시 유지. 승인된 미사용 생성물과 보관 위치 수정 대상은 별도 목록으로 구분 |
| P2 world-bundle 기록 | 현재 출력 6개로 검증 기록 갱신, 이 family에 대한 fingerprint 일치. 다른 family 값은 변경 없음 |
| 전체 검사·앱 재빌드·브라우저 조작·native 실행·배포 | 미실행. 파일 정리를 앱 기능·실기기 검증으로 간주하지 않음 |

로그는 외부 보관소의 `receipt-red.log`, `receipt-green.log`, `asset-tests.log`, `main-world-before.log`, `receipt-refresh.log`에 있다. 다른 P2 family 전체가 최신이라는 주장이나 전체 CI 성공을 의미하지 않는다.

## 최종 읽기 전용 점검

변경한 graph 소유 코드·회귀 테스트의 ESLint와 diff 공백 검사가 통과했다. 제거 경로의 부재, 외부 보관본 SHA-256, 새 보관 링크, 현재 자산 해시, 보호할 작업 상태, HEAD·index 불변을 확인했다. [최종 점검 목록](/D:/dev/release-evidence/PandoLab/branch-cleanup-20261021/final-audit.json)에 브랜치별 결과가 있다. 이 점검은 전체 CI 실행을 대체하지 않는다.

## 남긴 예외

없음

모든 정리는 로컬 미커밋 상태다. 기존 브랜치 HEAD와 Git index를 유지했다.
