# E4 — 웹 검수 화면 연결 계약 (2026-11-02)

**코드 브랜치:** `work/ui` · 선행: [E2 검수 이력](review-change-history-e2.md), [E3 데이터 비교](review-revision-diff-e3.md) · 후속: E5 Windows 검수 앱 연결

## 사용 경로

기존 웹 뷰어의 상단 `검수` 버튼(모바일은 메뉴의 `변경 검수`)으로 검수 패널을 연다. 패널은 숨김 상태에서 시작하고 클릭할 때만 `src/ui/inspector/viewer-review-panel.js`를 동적으로 불러온다. 기존 지도·Core 읽기/선택·시간축과 프로젝트 파일 읽기 동작은 바꾸지 않는다.

사용자는 E3 GitHub Actions 아티팩트에서 다음 JSON 파일을 추출해 동시에 선택한다.

- `e3-source-diff.json`: 실제 두 자료 리비전의 원본 국가·속성·형상 변경 목록.
- `e3-verification.json`: 검증 항목별 `passed` / `failed` / `not-run` 원문.
- `e3-pending-proposal.json`: E2 검수 제안서. 제안이 없다면 변경 목록만 읽는 경로.
- `e3-output-manifest.json`: 선택 시 파일 길이·SHA-256을 엄격하게 재검증하는 근거 목록.

`review-evidence-files.js`는 브라우저 파일 바이트를 읽고 WebCrypto SHA-256을 검사한다. `review-inspection.js`는 E2 제안서와 E3 원문이 **동일한 data repository/두 Git SHA/비교 월말/변경 필드/전후 값**을 가진 경우만 인정한다. 일부 배치는 `batchIndex/batchCount`를 표시한다. 파일이 잘못됐다면 새 자료를 적용하지 않고 기존 검수 패널 내용을 유지한다. 선택 가능한 파일은 명시된 E3 이름에 한정, 최대 4개, 개별 12MiB다.

## 변경 전후 지도 비교

현재 공개 뷰어는 언제나 기존 `config/library-data.json`에 고정된 **하나의 세계지도**만 렌더링한다. E4는 base SHA와 candidate SHA 중 어느 것이 현재 지도 pin인지 표시하며, 둘 다 아닐 때는 명시적으로 알린다.

사용자가 `변경 전후 형상 불러오기`를 누르면 선택된 원본 `sourceEntityId`의 바뀐 객체 파일만 정확히 두 Git 리비전에서 조회한다. 고정 URL은 `raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/<revision>/objects/<digest>.json` 형식이며 자격 증명이나 GitHub 쓰기 토큰을 포함하지 않는다. 원본 파일 SHA-256, 객체 ID, geometry `versionId`, 실제 좌표 JSON의 SHA-256을 **이중 대조**한 경우에만 두 화면의 다각형을 동일 투영·동일 맞춤 범위로 나란히 표시한다. 네트워크가 불가능하면 사용자가 원본 JSON 두 개를 직접 선택할 수 있다. 요청은 개별 최대 16MiB이며 취소·항목 전환 시 중단한다.

이 2개 작은 지도는 원본 형상 차이를 볼 수 있는 화면이지 전 세계의 완전한 이전/이후 역사 지도 렌더러가 아니다. 주변 국가·수계 위상 검사는 아직 실행하지 않았으므로 `geometry-topology:not-run`, 역사적 정확성은 `not-verified`로 유지한다. 어떤 좌표도 기존 Core 문서 또는 WebGL 장면에 적용하지 않는다.

## 객체별 조회·오류 지정

국가 ID·변경 종류로 필터하며, 연/월/일 정밀도와 정식명칭·일반명칭 차이를 그대로 보여 준다. 조사 보고서는 `reportPath` 및 독립 Git SHA를 조합한 **리비전 고정 GitHub 링크**로 연결한다. 표시 문자열은 `textContent`를 사용하며 불신 데이터의 HTML을 삽입하지 않는다.

`현재 지도에서 찾기`는 기존 문서의 원본 `sourceEntityId`와 프로젝트 객체 `id`가 정확히 1:1인 경우에만 `SelectionDomain.replace`와 `objectQuery.focusObjectRef`를 호출한다. 현재 역사 시점에서 객체를 찾지 못하면 이동할 수 없음을 알린다.

`수정 요청서 JSON 저장`은 문제 유형·선택 국가·변경 구간·데이터 SHA·사유를 포함한 **로컬 초안**을 만든다. 이 행위는 GitHub 이슈 생성, E2 이벤트(승인/수정 요청/반영) 기록, 실제 지도 데이터 수정이 아니며, 별도 사용자 승인과 외부 자료 게시 절차가 필요하다.

## 접근성·동결 범위·검증

반응형 overlay, 키보드 ESC 닫기·트리거로 포커스 복귀, `aria-expanded`/라벨/상태 안내, 라이트·다크 기존 토큰 적용. 창을 닫고 다른 파일을 열어도 기존 지도 상태·렌더 캐시는 보존한다. E4 수용 범위는 웹이며 Android 네이티브 기능을 개발하지 않는다. Windows 검수 GUI 연결은 E5다.

자동 검증: [.github/workflows/e4-web-review-acceptance.yml](../../.github/workflows/e4-web-review-acceptance.yml). 집중 계약 시험은 `tests/unit/document/review-inspection.test.mjs`, `tests/unit/ui/notification-priority.test.mjs`. 실제 브라우저는 `tests/browser/document/viewer-review-e4.spec.mjs` 및 기존 `viewer-project-open.spec.mjs`를 실행한다.

**배포 정책:** 코드 작성 및 CI 검증은 `work/ui`에서만 한다. `main` 통합과 Pages 배포는 수행하지 않으며, 실제 역사 GIS 원본·핀·C++/WASM·Rust·Android 파일도 수정하지 않는다.

