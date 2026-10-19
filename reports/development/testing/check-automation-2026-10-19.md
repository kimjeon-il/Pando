# 코드 변경과 검사 자동 선택·실행 연동

> 보고서 ID: `UI-CHECK-AUTOMATION-20261019` · 상태: `local-validation / known-product-failures / unpublished` · 지도 반영: `not-applicable` · 색인일: 2026-10-20
>
> 원문 최종 수정: 2026-10-20
>
> 조사 기준: 웹·앱 `work/ui`, 기준 커밋 `ac7cb2d8b31107203c64930e7c65b901cf504780` + 이 보고서와 같은 변경의 검사 자동화 소스
>
> 원본·출처: [구현 계획](../../../docs/superpowers/plans/2026-10-19-check-automation.md), [실행 계약](../../../docs/architecture/check-automation.md), [검증 근거](check-automation-2026-10-19.evidence.json)

## 대상과 기준일

로컬과 CI의 검사 목록·변경 감지·선행 조건·실행 경로를 연결했다. 제품 기대값을 코드에서 자동 복사하거나 실패한 기대값을 자동 수정하는 기능은 포함하지 않는다. 자동 실행 시점은 push/PR이며 로컬에서는 명령을 실행한다. 저장 감시기와 Git hook은 설치하지 않았다.

기존 `work/ui`의 Tauri 권한 파일, CRLF 차이 및 이전 미추적 Worker·브라우저 검증 자료를 보존했다. 제품 렌더러·C++·프로젝트 형식은 이 변경에서 수정하지 않았다. `main` 통합·push·공개 배포도 수행하지 않았다.

## 근거와 방법

`scripts/contracts/application-checks.json`은 검사 가족, 명시적 HTTP/자료 연결, 수동 측정 사유와 선행 명령을 소유한다. `plan-application-checks.mjs`가 현재 테스트를 발견하고 기존 AST·제품 자산 소유자를 사용해 역방향 의존성을 계산한다. 현재 발견된 파일은 단위 검사 465개, 브라우저 spec 151개다. 이는 등록 파일 수이며 통과한 검사 수가 아니다.

`run-application-checks.mjs`를 `pnpm.cmd run check:affected`와 CI가 함께 호출한다. `--list`는 실행 대상과 선정 근거만 출력한다. 로컬은 merge-base 이후 커밋·index·작업 트리·미추적 파일을 포함하고, push는 before/head, PR은 merge-base/head를 비교한다. 비교 기록이 없으면 마지막 커밋만 검사하는 이전 fallback 대신 실패한다.

등록 누락, 끊어진 import·fixture·명령, 알 수 없는 제품 동적 import, 순환 선행 조건, 미분류 제품 변경을 오류로 처리한다. 새 테스트는 현재 가족 규칙에 따라 발견되며 새 브라우저 책임은 명시적으로 등록해야 한다. 알려진 URL 기준 경로와 앱 staging의 소스 이동만 계약으로 둔다. 단순 디렉터리 기준 URL은 모든 형제 파일을 소비한 것으로 취급하지 않는다.

## 확인 결과와 한계

| 실행한 확인 | 결과 |
| --- | --- |
| 선택기·실행기·CI 계약 및 P1/P3/P4·버전 관련 단위 검사 | 48/48 통과. 새 Worker 변경이 `physical-land-time.spec.mjs`까지 선택되는 회귀 검사 포함 |
| 변경한 JavaScript 8개 lint | 통과 |
| 실제 로컬 `check:affected --list --base HEAD` | 성공. 기존 미추적 자료를 포함한 1,019개 경로에서 단위 파일 18개·브라우저 spec 4개·명령 7개 선정. 실행하지 않은 검사를 통과로 기록하지 않음 |
| 실제 공통 실행기로 `check-runner.test.mjs` 실행 | lint와 5개 테스트 통과 |
| 실제 공통 실행기로 기존 `application-composition.test.mjs` 실행 | `propertySelection.workspaceUiA capability port is too broad` 실패를 비정상 결과로 전달. 기준을 완화하지 않음 |
| 실제 공통 실행기로 `physical-land-time.spec.mjs` 실행 | Core·생성 자산 preflight·lint 통과. Canvas 통과, WebGL2 실패 |
| WebGL2 단독 재확인 | 같은 `[PL-MESH-PREPARE]` Worker 30,000ms 시간 제한 오류 재현. 물리 육지 픽셀 비교는 유지되지만 오류 배열이 비어 있지 않아 실패. 시간 제한·기대값을 변경하지 않음 |
| 웹·앱 staging 실제 실행 | 통과. 웹 1,398개 파일 / 113,970,346 bytes, 앱 small-project 1,121개 / 62,454,474 bytes, full-world 1,719개 / 154,471,193 bytes. 두 프로필 검증이 각각 실행됨. 네이티브 앱 실행 증거와 구분 |

WebGL2 재확인은 1280×800 Chromium SwiftShader에서 실행했다. 자동화 변경은 런타임 제품 파일을 수정하지 않았으며 이 오류를 해결했다고 주장하지 않는다. 기존 편집 포트 제한 실패도 별도 미해결 항목이다. 자동화가 실패를 올바르게 전달하는 것과 제품 검사 전체가 통과하는 것은 별개다.

검사 실행기는 동일 argv라도 선행 staging 문맥이 다르면 재실행한다. small-project 검증 뒤 full-world로 산출물을 교체했을 때 두 번째 검증을 생략하던 초기 구현 문제를 회귀 테스트로 수정했다. native country 자기검사·canonical/전체 유효성·territorial-library 계약도 카탈로그에 유지했다.

외부 네이티브 C++와 GIS Python은 기존 P1/P4 실행 위치를 유지한다. 공통 실행기는 해당 요구를 `not-executed-by-application-runner`로 기록한다. 실제 GitHub Actions 원격 실행, Windows 네이티브 UI, Android, 전체 테스트·모든 GIS 데이터 검사는 이번 자동화 검증에서 실행하지 않았다.

## 데이터 반영

지도 자료 변경은 `not-applicable`이다. 기존 YAML별 복제 검사 목록과 전체 단위 목록을 파싱하던 조립 경로, 마지막 커밋 비교 fallback을 제거했다. 기존 수동 경계 계측·P2 자산 순서·P3 artifact-result SHA 검증은 유지했다. UI·place·reference 전용 워크플로는 같은 실행기를 호출하는 수동 진입점으로 남기고 자동 PR/main 검사는 Application Architecture가 소유한다.

이 구조는 관련 검사 선택을 보수적으로 자동화한다. 의미상 필요한 기대값이나 모든 실행 분기를 자동 추론하지 않는다. 기능 계약 변경 시 현재 테스트·fixture·mock을 함께 고치는 책임은 유지된다. 새로운 비 import 관계는 카탈로그에 등록해야 한다.

## 판본

후속 수정: [편집 포트 제한과 WebGL 면 준비 시간 초과 수정](port-mesh-worker-fixes-2026-10-20.md). 이 문서의 실패 결과는 당시 기록으로 유지한다.

첫 구현 검증 기록이다. 원격 CI·네이티브 검증과 남은 제품 오류를 후속 확인할 때 이 기록을 당시의 통과 증거로 확대하지 않는다.

배포·브랜치 통합 후속: [UI-RELEASE-SYNC-20261020](shared-viewing-release-sync-2026-10-20.md). 당시 로컬 검증의 범위와 미검증 항목은 위 기록을 유지한다.
