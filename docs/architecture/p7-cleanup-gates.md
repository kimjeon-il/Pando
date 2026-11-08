# P7 — 검증 기반 레거시·중복 제거 게이트

범위: `work/objects` P0–P6 후속 정리. 최종 P7 성능 수용 또는 main 병합 승인을 뜻하지 않는다.

## 출발점과 차단 상태 (2026-11-06)

- 기준 `main@7cd224bd198c014d2215e35a93452702227d8314`: 추적 파일 2,993개, Git blob 크기 합계 31,973,581 B, 공유 프런트엔드 JS 모듈 216개.
- P6 `work/objects@1668d6b56ad22940c6dd17fd0345ea8521a733ff`: 파일 3,000개, Git blob 크기 합계 32,046,148 B, 공유 JS 모듈 217개. 이 숫자는 **Git 정적 측정**이며 페이지 로딩/메모리/GPU 성능 수치가 아니다.
- P6 커밋에는 `[skip ci]`가 있어 해당 SHA의 GitHub Actions 실행 결과가 없다. 이전 P5 PR head `dcd57b9`의 Application checks CI는 **실패**했다. P5 테스트 구성의 미주입 11건은 P6에서 수정했지만 새 HEAD에서 CI 재검증하지 못했다.
- 이전 브라우저 실패는 지도 초기 게시·prepared resource 재사용·정보창 표시, 지형 인터랙션·미리보기·LOD 연속성 타임아웃 등이다. 동일 환경에서 원인·결과를 다시 확인하기 전에는 회귀/환경 문제를 임의로 성공 처리하지 않는다.

## 제거 의사결정

1. **안전한 1차 통합:** `viewer-map-presentation-policy.js`는 `viewer-map.js`의 단일 입력/표시 어댑터이며 다른 저장·정본 소유권이 없다. 내장된 기존 구현을 한 글자도 바꾸지 않고 소유자인 Viewer Map으로 이동, 분리 파일을 제거한다. UI의 error/ready/retry·입력 제외 선택자를 집중 단위 검사한다. 동일성 근거는 이전 구현과 인라인 본문의 텍스트 동등성이다.
2. **레거시 정리:** 사용자 승인을 받아 `apps/editor/**`의 퇴역 Windows 검수기/스테이징, 아이콘·설정 및 관련 전용 CI·테스트를 제거했다. Web Viewer의 읽기 전용 Inspector, C++/WASM 정본과 무관한 네이티브 명칭의 GIS/계산 테스트는 삭제 대상이 아니다. P6 GPKG, 역사 자료·원본 데이터 핀은 그대로 유지한다.
3. **중복 모델·불필요한 파일:** 실제 실행 경로·테스트·문서/배포 참조를 근거로 단일 소유자가 입증될 때만 합친다. C++ 타임라인을 JS의 두 번째 저장 정본으로 바꾸지 않는다. 큰 파일로 무조건 합치는 것도 최적화가 아니므로 책임 경계를 유지한다.

## 남은 P7 검증 게이트

- 변경 범위: Viewer 관련 집중 Node unit + 프로덕션 번들 정적 경계 + 실 브라우저 지도 준비/오류/정보창 + 읽기 전용 Inspector/프로젝트 열기.
- 전체 P0~P6 통합: 고정 코드/자료 핀, 실제 GPKG↔C++ 왕복 및 최신 PR head의 CI 결과를 확보해야 한다. 기존 실패는 고치거나 사전 존재 결함으로 근거 있게 분리해야 한다.
- 성능 수용: P0의 **동일 브라우저·기기·데이터·캐시** 조건으로 초기 맵 표시, 날짜 전환, 프레임, CPU/GPU 메모리와 다운로드를 측정해 기능·데이터 동일성 및 퇴보 없음을 입증한다. 현재 실측값은 **미수집**이며 정적 Git 파일 수를 성능 향상으로 환산하지 않는다.
- 승인 전 `work/* → main` 병합과 웹 Pages 배포 금지.

### 첫 변경의 정적 근거

`viewer-map-presentation-policy.js`에 있던 선택자 상수와 프레젠터 함수 본문을 그대로 `viewer-map.js`로 옮겼다. 인라인 이전·이후 함수 코드는 동일하며, 프로젝트 데이터·C++·WASM·렌더링 파이프라인·수계·지명·자료 핀은 수정하지 않는다. 새 `tests/unit/p7-viewer-presentation.test.mjs`은 실제 인라인 구현의 ready/error/retry 상태 변화를 검사한다.

## P7 후속 — 불변 수계 조회 재사용

- `project-session.js`의 `state.itemVisibility`는 매 getter 호출마다 `projectResourceOverlay('hydro', …)`를 생성했다. 지금은 수용된 C++ `documentModel.list('hydro')` 배열 정체성이 바뀔 때에만 원본 대체 마스크를 재구성한다. 설정된 프로젝트별 가시성은 매번 최신 값을 사용하며 원본 ID를 지우지 않는다.
- `physical-settings.js`의 선형 `hydroEditById` 검색과 `isHydroEditFeature`의 배열 `includes` 검사는 이미 존재하던 `projectHydroResources()`의 작성 객체 ID 색인으로 통합한다. C++ 불변 목록의 갱신·이전 원본 복원 시 기존 캐시 무효화 규칙을 유지한다.
- `tests/unit/document/p7-hydro-lookup-cache.test.mjs`에서 원본 마스크의 반복 계산 생략, 프로젝트/날짜 목록 교체, 명시적 표시 설정 유지, 작성 객체 조회와 식별자 분리를 집중 검증한다.
- 계측 전 성능 향상 수치는 주장하지 않는다. 기존 CI/브라우저 검증 게이트는 그대로 남는다.

## P7 메모리 할당 감소 — 기본 수계 별칭 조회

- `builtInHydroFeatureById`의 캐시 미스 경로는 매번 `[...hydroFeatureCache.values()]`로 전체 하천·호수 배열을 생성한 뒤 순회했다. 내부 조회를 `Map.values()` 반복으로 바꿔 동일한 첫 매치 규칙·반환값을 유지하고 임시 배열 할당을 제거했다.
- 공개 `allBuiltInHydroFeatures()`의 배열 반환 계약은 그대로 두었다. 집중 테스트는 1,024개 합성 수계의 직접 ID, 원본 fragment ID 별칭, 미존재 조회와 전체 열거 계약을 확인한다.

## 레거시 소비자 제거 및 유지 판정

- 퇴역 Windows 아이콘(`apps/editor/src-tauri/icons/*`)과 `design/brand/windows*.svg`, 전용 `brand-platforms.test.mjs` 및 Windows 실행·스테이징 코드(`apps/editor/**`)가 삭제됐다. 과거 판단/검증 파일은 Git 이력으로 추적한다.
- 앱 삭제 후 남았던 스테이징 파일 참조를 `scripts/lib/reviewer-ui-contracts.mjs`, `scripts/r4d-check-retired-tests.mjs` 및 `tests/unit/viewing-ui-contract.test.mjs`에서 정리했다. 이제 Web Viewer 자체의 읽기 전용 계약을 직접 확인한다.
- `tests/native/temporal-parity-p5-7.test.mjs` 등 C++/WASM·GIS 계산 검증은 앱 설치물과 무관한 독립적인 정본 회귀 증거이므로 유지한다.
- 외부 라이브러리 자료, C++ 코어, WASM, GeoPackage 포맷·검수기는 레거시 제거 대상이 아니며 그대로 둔다.

## 최신 검증 장부

- `tests/unit/p7-viewer-presentation.test.mjs`, `tests/unit/document/p7-hydro-lookup-cache.test.mjs`는 `scripts/contracts/application-checks.json`의 활성 `units` 그룹 범위에 포함된다. 신규 테스트 파일을 등록되지 않은 상태로 남기지 않는다.
- 수정된 P7 실제 함수에 대해 독립 실행한 합성 검증: 프로젝트 수계 캐시·원본 대체 마스크 **11개 검사 통과**, 하천 1,024개 직접/논리 ID 조회 **4가지 검증 통과**. 첫 작성 테스트에서 캐시 키 가정을 잘못 적용한 것은 `499a0b34`에서 바로잡고 재검증했다. 전용 Node 전체 테스트 실행, 프로덕션 WASM, 실제 브라우저 수용을 대체하지 않는다.
- P5 이전 Application checks(`42046742980`)의 Unit 실패에는 새 점검기 팩터리 주입이 누락된 구성 테스트 11개가 있었다(P6에서 코드 보정, 최신 재실행 미확인). Browser 실패는 초기 국가 게시 세대 미일치(`map-startup-publication`), WebGL 날짜 전환 정체(`resource-dependency-reuse`), 외부 GPKG 열기 후 viewer readiness 정체(`shared-viewing-shell`), 지형 인터랙션/LOD 타임아웃이었다. 테스트 대기시간만 늘려 통과로 위장하지 않는다.
- 권장 영향 범위 검증: `node --test tests/unit/p7-viewer-presentation.test.mjs tests/unit/document/p7-hydro-lookup-cache.test.mjs tests/unit/data/p6-project-persistence.test.mjs tests/unit/ui/app-hydro-settings.test.mjs tests/unit/project-resource-overlay.test.mjs tests/unit/app/viewer-initial-composition.test.mjs`; 변경 파일 ESLint, Viewer 프로젝트 열기/맵 준비/Inspector에 대한 선택적 브라우저 회귀. WASM 도구 또는 원본 데이터가 없는 환경에서 전체 검사를 강행하거나 CI 준비를 위해 SDK를 설치하지 않는다.

**차단 게이트:** P7 재검증용 GitHub Actions는 실제로 실행 중이다. P1·P2·P3·P4·Core·지명 동기화 등은 확인된 실행에서 일부 또는 전부 통과했으나, 최신 코드의 전체 Application checks·DEM Gate와 실제 브라우저 성능 측정은 모두 최종 수용 전 확인해야 한다. 앞선 실패나 현재 진행 중인 검사를 통과로 바꾸어 표시하지 않는다.

## P7 Windows 소스 제거 승인 적용 — 2026-11-06

사용자의 명시적 삭제 지시에 따라 `apps/editor/**` 잔여 Windows 스테이징/아이콘/시험파일,
`design/brand/windows*.svg`, Windows 전용 테스트와 R4 편집기 소스 전용 CI 워크플로를
삭제했다. 이 자료는 Git 이력에 남는다. **기존 사용자의 설치본·프로필·캐시와 원본 지도는 삭제하지 않았다.**
개발 서버는 Viewer만 허용하고, 기본 패키지 관리자 준비는 루트 한 번만 수행한다.
Viewer의 검수기 활성화는 `?inspect=1`·`?debug=1`·단축키 경로만 유지한다.
기존 스테이지 캐시 정리 함수는 사용자 로컬의 현재 상태를 검증하고 보호하기 위해
별도 마이그레이션 승인 전 유지한다.

새 `tests/unit/p7-retirement-closure.test.mjs`는 실제 원본·테스트/CI 잔여 파일의 부재와
읽기 전용 Viewer/Inspector 계약을 검사한다. 기존 CI에서 실패한 4개 브라우저 그룹에는
실패 시 정본 C++ 시점·GPU 준비 상태·LOD·진단 코드를 출력하는 관측 코드를 추가했다.
이 관측은 테스트의 통과 기준을 완화하지 않는다. CI 최신 SHA 확인 전 통합 통과를 주장하지 않는다.

## P7 후속 2026-11-06 — 업로드 기아 방지 및 직접 성능 계측

- `gpu-upload-scheduler.js`: `isInputPending()===true`이면 전체 업로드를 중단하던 조기 반환을 제거했다. `allowDuringInteraction` 작업만 기존 **2ms CPU 제출 / 256KiB 계획 예산**으로 진행하며, 일반 작업은 500ms 입력 휴지 기간 동안 계속 대기한다. `gpu-upload-staging.test.mjs`에 실제 스케줄러의 입력 중·휴지 중·해제 후 검증을 추가했다. 새 코드의 격리 실행은 3가지 동작 모두 통과. 실제 GPU 타일의 완성·속도는 브라우저 CI가 증명해야 한다.
- 동일 V8 실행 인스턴스의 합성 불변 수계 4,000개, ID 조회 10,000회×5회에서 `main` 정본(`physical-settings.js@c584226d`) 중앙값 1,364ms, P7(`physical-settings.js@b1630464`) 2ms를 측정했다. 이는 **해당 조회 연산에만** 해당하며 실제 브라우저의 초기 지도 표시 시간/날짜 이동/프레임 속도/GPU 메모리 개선률이 아니다.
- 마지막 실행 소스 SHA: `c517e6c5ddf40ea58575c359f1bead04f4839549`. 지도 게시·GPKG 재열기·WebGL/Canvas DEM 및 LOD의 실제 수용 시험과 동등 조건 브라우저 성능 비교는 아직 P7 완료 차단 요인이다.
