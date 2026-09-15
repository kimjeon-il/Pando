# 러시아 상세 형상 편집: 구현 및 검증 기록

작업 범위: 로컬 구현과 집중 검사. 커밋·푸시·배포는 수행하지 않았다. 기존 미커밋 작업과 해안선 자동 탐지 정책은 유지했다.

## 적용한 공통 경로

- 국가·하위단위·일반 객체·편집 수계 원본을 지도 편집 Worker에 동기화한다. 형상 변경과 표시 메타데이터 변경을 구분하며, 후속 요청은 변경분을 전달한다.
- 영토 미리보기는 동기화된 원본을 ID로 읽고 변경 객체만 반환한다. 검증 결과에는 원본 리비전과 준비 결과 ID를 연결한다. 적용 전 검증 결과를 확인하고 동기 트랜잭션으로 반영한다.
- 그린 영역의 교차 연산, 정밀 선 검사와 분할, 지방 합병·재지정, 스냅 후보 준비, 관계 후보 포함 검사, 표시용 육지 맞춤을 Worker에서 처리한다.
- 선분 인덱스와 변하지 않은 초안 선분의 교차 결과를 재사용한다. 스냅 후보의 객체 배열 앞부분 제한을 제거하고 날짜변경선 후보를 보존한다. 합병 인접 판정도 공간 후보를 먼저 줄인 뒤 기존 정밀 판정을 수행한다.
- 내부 경계는 국가별 준비 결과를 재사용한다. 상위 강조선 비교용 인덱스도 형상 버전별로 공유한다. 렌더 함수에서는 준비 결과만 사용하고 오래된 경계는 숨긴다.
- Worker 분할 결과의 표시 키 충돌로 한쪽 미리보기만 남는 문제를 함께 수정했다.
- 라이브러리 항목들을 하나의 Worker 초안에서 순서대로 처리한다. 영토 변경 확인 후 추가할 때 같은 준비 결과를 재사용한다.
- 이력과 자동저장은 형상 버전별 동결 복사본을 공유한다. 이력 복원은 그대로인 현재 형상을 재사용하고 변경된 형상을 분리한다. 대기 자동저장을 합치며, 취소·삭제 뒤 대기 저장이 되살아나지 않도록 한다.
- 프로젝트 파일 구조와 기본 사용자 설정은 변경하지 않았다. 이력/캐시 내부 식별자는 저장하지 않는다.

주요 구현 파일: `map-edit-worker-client.js`, `edit-source-tracker.js`, `map-edit-worker.js`, `app-territorial-drafts.js`, `app-cut-geometry.js`, `geometry-segment-index.js`, `rendering-domain.js`, `edit-display-preparation.js`, `geometry-versions.js`, `app-project-snapshots.js`, `project-serializer.js`, `persistence-service.js`.

## 집중 검사

전체 테스트·전체 린트는 실행하지 않았다. 아래 묶음은 중복되는 파일이 있으므로 통과 건수를 합산하면 안 된다.

| 묶음 | 결과 |
|---|---|
| 작업 시작 전 기존 경계 준비·Worker·영토 편집·조각 선택 | 41/41 통과 |
| 공통 변경 후 Worker·검증·형상·표시·이력·저장·라이브러리·GIS | 81/81 통과 |
| 동기화·Worker·캐시·저장·정규화·패킷 후속 검사 | 34/34 통과 |
| 추가 Worker 미리보기·영역 그리기·지방 편집과 관련 규칙 | 24/24 통과 |
| 인접 인덱스·표시 캐시·영토 규칙 | 17/17 통과 |
| 마지막 이력 공유·분포·일반 객체·하위단위 정규화 | 23/23 통과 |
| 프로젝트/자동저장 직렬화 | 5/5 통과 |
| 변경 JavaScript·테스트 ESLint | 통과 |
| Worker 및 명령 아키텍처 검사 | 통과 |

주요 실행 명령:

```text
node --test tests/unit/edit-source-tracker.test.mjs tests/unit/edit-preparation.test.mjs tests/unit/map-edit-preparation-worker.test.mjs tests/unit/map-edit-worker-client.test.mjs tests/unit/persistence-service.test.mjs tests/unit/territorial-units.test.mjs tests/unit/editing-render-packet.test.mjs
node --test tests/unit/edit-preparation.test.mjs tests/unit/territorial-edit-plan.test.mjs
node --test tests/unit/edit-preparation.test.mjs tests/unit/distribution-model.test.mjs tests/unit/generic-feature-service.test.mjs tests/unit/territorial-units.test.mjs
node --test tests/unit/project-serializer.test.mjs
node scripts/check-worker-architecture.mjs
node scripts/check-command-architecture.mjs
```

브라우저는 저장소 Playwright 실행기로 Chromium을 사용했다. 기본 headless-shell에서 준비 완료에 도달하지 못해 `channel: chromium`으로 실행했다.

- `territory-components-responsive.spec.mjs`: 러시아 조각 선택·연속 입력·확대·취소 통과.
- `russia-edit-preparation.spec.mjs`: WebGL2·WebGL1·Canvas에서 러시아 영역 생성·내부 경계 갱신·Undo·해안선 준비 취소 통과.
- 같은 파일의 러시아 선 검사: 실제 한 번 관통하는 좌표에서 두 분할 미리보기와 단계 취소 후 원본 보존 통과.
- 중첩 생성·Undo/Redo·부모 후보·잠금·IndexedDB 저장 후 재열기 통과.
- 소련 라이브러리 추가: 영향 확인 전 러시아 원본 유지, 확인 단계에서 Worker 배치 요청 1회 재사용, 한 번의 Undo로 복원 확인.

실패한 검사도 구분한다. 기존 `renderer-responsiveness-source.test.mjs`의 GPU 수계 업로드 큐 소스 단정 1건은 현재 구현과 일치하지 않아 실패했고 이번 범위에서 변경하지 않았다. 같은 파일의 Worker 단정은 새 읽기 전용 경로에 맞춰 수정하여 해당 항목만 재실행해 통과했다. 기존 `boundary-cut-snapping.spec.mjs`는 현재 하천 UI와 맞지 않아 분할 경로에 도달하지 못했다. 이 파일은 원래 상태로 유지하고 현재 러시아 추가 흐름에 별도 검사를 작성했다.

## 측정과 제한

실행 중 확인한 러시아 형상은 앱 0.33.0, Polygon 214개, 좌표쌍 36,756개이다. 기준 좌표를 줄이거나 작은 섬을 제거하지 않았다.

개발 중 기록한 영역 그리기 이후의 메인 스레드 작업:

| 렌더러 | 50ms 이상 작업 | 최장 작업 | 기록된 Worker 실행 요청 |
|---|---:|---:|---:|
| WebGL2 | 25 | 600ms | 13 |
| WebGL1 | 18 | 605ms | 12 |
| Canvas | 14 | 595ms | 12 |

렌더러별 기록 시점의 구현은 동일하지 않으므로 렌더러 간 우열이나 최종 개선율 비교에 사용하지 않는다. 최초 브라우저 기준 측정은 시작 준비 단계에서 실패했으므로 유효한 전후 개선율을 제시할 수 없다. Node 실제 Worker에서 러시아 원본 준비 약 133ms, 작은 하위단위 미리보기 약 603ms도 기록했지만 브라우저 입력 지연과 다른 측정이다.

아직 600ms급 메인 스레드 작업이 남는다. 해당 작업의 함수별 비용과 입력 지연 분포, 모든 내부 도형 연산 횟수는 계측하지 않았다. 계획의 모든 국경·해안선 적용 조합, 일반 영역과 물 표시의 픽셀 비교, 다중 라이브러리 루트의 전체 UI 조합은 실행하지 않았다. 관련 형상·잠금·자손·일괄 적용 규칙은 집중 단위 검사로 확인했다.

남은 구조적 비용은 첫 대형 원본/인덱스 준비, 독립 지방을 포함하는 혼합 경계 그룹의 전체 준비, 사용자 교체 기본지도의 JSON 이력 복원, 현재 상태 복원 후 렌더·공간 인덱스 갱신이다. 이 목록은 코드 경로 기준이며 관측한 최장 작업의 원인으로 단정하지 않는다.
