# 하위 객체 해안 점선 재발과 수정 유실 여부 조사

> 보고서 ID: `UI-COAST-RECURRENCE-20261019` · 상태: `deployment-parity-confirmed / recurrence-not-reproduced / not-fixed` · 지도 반영: `not-applicable` · 색인일: 2026-10-19
> 원문 최종 수정: 2026-10-19
> 조사 기준: 웹·앱 소스 `264fff61b7f4138c9f19d56d2ef8bc917dce5730`, 공개 build `0.36.0-build-da7b744937ec`
> 원본·출처: 사용자 홍콩 점선 화면, Git 이력, 공개 파일 응답, 별도 소유 Edge의 실제 내장 지도 Worker 계측

## 대상과 기준

사용자는 해안 점선 재발과 이전 수정 유실 여부 조사를 요청했고, 구현은 우선 계획만 작성하도록 지시했다. 이후 경계 위치·해안 등 판정은 상위/하위가 공유하고 계층에 따라 선 모양만 달라야 한다고 명확히 했다. 제품 코드·형상·저장 형식은 변경하지 않았다.

## 근거와 방법

- 수정 커밋 `740e6669`부터 현재 HEAD까지 `boundary-topology.js`, `country-shared-boundary-packet.js`, `country-shared-boundary-worker.js`, `canvas-scene-composition-core.js`, `gpu-map-renderer.js`, `child-coast-boundary.spec.mjs`의 diff를 확인했다. 결과는 비어 있다.
- 공개 사이트에서 앞의 경계 관련 4개 파일을 다시 GET하고 HTTP 200, 현재 Git blob과 SHA-256 일치를 확인했다. 작업 디렉터리의 CRLF 변환과 구별하기 위해 비교 기준을 Git blob으로 삼았다.
- 별도로 띄운 Edge의 새 컨텍스트에서 WebGL을 비활성화하고 실제 Canvas Worker를 사용했다. 공개 응답은 수정하지 않고 Worker 메시지를 관찰했다. 내장 지도, 1280×800 CSS px, 색채 지형, 홍콩 중심 지구본 배율 16에서 상세 DEM 준비 후 경계 패킷을 기록했다.
- 원시 계측 스크립트와 PNG는 `D:\dev\release-evidence\diagnose-coast-recurrence.mjs`, `coast-audit-initial.png`, `coast-audit-restored.png`에 있다. 요약과 파일 hash는 [기계 판독 근거](child-coast-recurrence-audit-2026-10-19.evidence.json)에 보존한다.

## 확인 결과와 한계

### 수정 유실 여부

현재 소스와 현재 서버 파일에서는 수정 삭제·이후 병합의 되돌림·옛 파일의 역배포가 확인되지 않았다. 이전 해안 수정 코드는 그대로 배포되어 있다. 다만 사용자의 기존 탭이 실제로 받은 파일과 캐시 출처를 읽은 것은 아니므로 브라우저 캐시 탓이라고 단정할 수 없다.

### 현재 재현 결과

첫 canonical 공유 경계의 홍콩 결과는 14개 선분이며 양 끝 위도 22.3도 미만인 남쪽 해안 표본은 0개였다. 영토 경계 장면도 홍콩 주변 14개 선분, 남쪽 해안 표본 0개였다. 런타임 pageerror는 없었다. 이 새 컨텍스트의 조건에서는 사용자의 해안 점선을 재현하지 못했다.

시점을 10월→9월→10월로 왕복한 뒤 영토 경계 역시 위 결과를 유지했다. 다만 캡처는 Canvas 표시 스타일 revision 일치를 기다렸으며 공유 경계 Worker의 모든 최신 작업 완료·승격까지 기다린 것은 아니다. 이 결과로 전체 시점 왕복 경계 계약이 검증됐다고 주장하지 않는다. WebGL, 사용자의 기존 탭, 고유 색상 토글, 모든 준비 중 프레임은 이번 조사에서 검증하지 않았다.

### 실제로 나뉜 경계 규칙

- 상위 객체는 `gpu-map-renderer.js`의 국가 경계 출력에서 `shouldShowSharedCountryBorders`에 따라 shared/outline 모드를 선택한다. 현재 색채 지형은 shared로 해안을 제외하고 다른 모드는 outline 경로를 사용한다.
- 하위 객체의 영토 경계는 `map-display-preparation.js` → `buildTerritorialInternalBoundarySegments`에서 별도로 계산하며, 부모와 일반 자식의 합집합 외곽을 제외한다. 이 생성 단계에는 국가 경계의 shared/outline 정책이 전달되지 않는다.
- 일부 내장 하위 객체는 국가 공유 경계 패킷의 `internalOwners`에도 들어간다. 이번 계측에서도 CHN|HKG 접촉이 공유 경계와 영토 경계 양쪽에 존재했다. 실제 이중 그리기 여부와 이번 해안 점선의 원인은 아직 별도로 확인해야 한다.

따라서 “같은 판정에 선 모양만 다르다”는 사용자 계약을 현재 구조 전체가 충족한다고 볼 수 없다. 다만 이것만으로 이번 사용자 화면의 직접 원인을 확정하지 않는다.

### 이전 검증이 놓친 범위

이전 `child-coast-boundary.spec.mjs`는 CHN/HKG/MAC 세 객체로 구성한 파일을 열고 `territorial-boundaries` 도메인의 선분을 검사했다. 실제 내장 객체 ID, 국가 공유 경계 패킷 전체, 시점 왕복과 해안 픽셀을 합격 기준으로 검사하지 않았다. 따라서 이전 4개 브라우저 검사 통과는 실제 내장 지도의 모든 경로에서 해안 점선이 없다는 근거가 되지 않는다.

## 데이터 반영과 후속 작업

제품 수정·테스트 스위트 실행·커밋·푸시·배포는 하지 않았다. read-only 공개 사이트 진단만 실행했다. [수정 계획](../../../docs/superpowers/plans/2026-10-19-child-coast-recurrence.md)에 사용자 탭의 실제 자산 대조, 남은 재현, 공통 모드 정책과 출력 소유자 통일, 회귀 검사를 기록했다. 객체 없는 시기의 육지 소실은 기존 별도 미수정 조사 항목으로 유지한다.

## 판본

이 보고서는 [이전 해안 수정 보고서](child-coast-boundary-2026-10-19.md)의 검증 범위를 보완한다. 당시 단위·파일 열기 검증과 배포 기록을 삭제하지 않으며, 그 결과를 이번 재발 원인이 해결됐다는 뜻으로 확대하지 않는다.

## 구현 후속

이 조사의 구현·검증 후속은 [UI-SHARED-VIEWING-20261019](shared-viewing-cleanup-2026-10-19.md)에 기록한다. 이 문서의 당시 조사·배포 상태를 새 검증 결과로 소급 변경하지 않는다.
