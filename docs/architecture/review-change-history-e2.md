# E2 — 검수 제안·변경 이력 Sidecar 계약

**대상:** Pando `work/ui` · Web/Windows 공통 계약 · 2026-11-02
**선행:** [E1 공통 지도 읽기 엔진](map-readonly-engine-e1.md)
**후속:** E3 데이터 리비전 비교 → E4 웹 검수 UI → E5 Windows 연결 → E6 구형 편집기·Android 네이티브 제거 → E7 최종 회귀 검사

## 1. 데이터 소유권

- 국가 원본과 실제 역사 기록의 정본은 외부 `kimjeon-il/PandoLab-library-data`이며, 코드 저장소 `Pando`는 스키마·검증 코드·합성 픽스처만 보관한다.
- E2 검수 기록은 기존 프로젝트/GeoPackage 저장 형식, C++ Core 문서, `timelineRecords`, 좌표/형상/국기를 **변경하지 않는 Sidecar**다. 두 번째 세계지도 모델이나 편집 history owner를 생성하지 않는다.
- 제안은 외부 라이브러리의 `baseRevision`와 `candidateRevision` 두 개의 서로 다른 40자리 Git SHA에 고정한다. `work/ui` 커밋과 데이터 커밋은 다른 버전 축이며, E3에서는 동일 역사 시점에서 두 데이터 버전을 비교한다.
- 검수 객체는 원본 `sourceEntityId` (예: `state:...`)로 식별한다. 앱 프로젝트 인스턴스 `id`, 형상 `versionId`, 지도 렌더링 ID를 섞지 않는다.
- `validFrom`/`validTo`는 null 또는 기존 C++ temporal 엔진이 인정하는 `YYYY`, `YYYY-MM`, `YYYY-MM-DD` 및 확장 연도 규칙을 따른다. 양끝 포함·날짜 정밀도 보존. `comparisonMonth`는 지도 비교 전용 월말 커서(`YYYY-MM`) 또는 명시적인 null이다. 역사 사건을 월말 사건으로 바꾸지 않는다.

## 2. 스키마 v1

한 제안은 `{schemaVersion:1,proposal:{...},events:[]}`로 기록한다.

`proposal`의 필수 항목: `proposalId`, `createdAt`(UTC ISO milliseconds), `createdBy`(ai|human), `dataset`(repository/baseRevision/candidateRevision), `comparisonMonth`, `evidence[]`, `changes[]`. 선택 `supersedesProposalId`는 기존 제안의 ID를 가리키며 이전 이력을 덮어쓰지 않는다.

각 `evidence`는 `id`, `reportPath`, `revision`(보고서 독립 Git SHA)를 가진다. 각각의 변경에 `evidenceIds[]`로 정확히 연결한다. 보고서는 `reports/<정규 분류>/<작업 범위>/<파일>.md` 또는 검증 JSON이어야 한다. 절대경로·외부 URL·경로 탈출을 허용하지 않는다.

| `changes[].kind` | `field` (논리 필드) | `before` / `after` |
| --- | --- | --- |
| `geometry` | `geometry` | `{versionId,sha256}` 또는 null. 좌표 원본 없음 |
| `name` | `names.ko.formal`, `names.ko.common`, `names.en.formal`, `names.en.common` | 문자열 또는 null |
| `flag` | `metadata.flagHistory` | `{sha256}` 또는 null. 이미지/Base64 원본 없음 |
| `parent` | `parentEntityId` | 원본 `sourceEntityId` 또는 null |
| `lifetime` | `lifetime` | `{validFrom,validTo}` 또는 null |

한 변경 항목은 `sourceEntityId,kind,field,validFrom,validTo,before,after,evidenceIds`를 필수로 포함한다. 변경 전후 값이 같거나 동일 객체·필드·시간 구간을 중복 기재하면 오류다. 국명 일반명/정식명 구분과 기존 형상·해안 별도 조사 원칙을 유지한다. 지원되지 않는 국제 승인·비지도 정보는 추가하지 않는다.

합성 테스트 원본: [e2-synthetic-review.json](../../tests/fixtures/review/e2-synthetic-review.json). 실제 역사적 사실이나 승인 내역이 **아니다**.

## 3. 이력은 append-only 이벤트

제안 자체는 불변이며 검수/반영 상태는 `events[]`를 시간 순으로 재생해 구한다. 각 이벤트는 유일한 `eventId`, UTC `at`, `actor:{kind,id}`를 포함한다.

| 이벤트 | 작성 주체 | 선행 상태 | 결과 |
| --- | --- | --- | --- |
| 제안 생성 | ai/human | 없음 | `pending` |
| `validated` | ci | pending/blocked/validated | 모든 검사 passed → `validated`, otherwise `blocked` |
| `changes-requested` | human | pending/blocked/validated | `needs-revision`, 종결 |
| `approved` | human | validated | `approved` |
| `rejected` | human | pending/blocked/validated | `rejected`, 종결 |
| `applied` | ci | approved | `applied`, 종결 |

`validated`는 검사 `name/outcome` 목록, 코드 `codeRevision` SHA, 보고서 `reportPath`가 필요하다. 기본 필수 검사: `schema`, `temporal`, `source-integrity`. 형상 변경은 `geometry-topology`, 상위 객체 변경은 `parent-graph`도 요구한다. `not-run`/`failed`를 pass로 가장할 수 없다. `changes-requested`/`rejected`에는 이유가 필수이다. `applied`는 실제 반영 데이터 `appliedRevision` SHA와 검증 보고서 경로가 필요하다.

**보안 범위:** Sidecar의 문자열 `actor.kind="ci"`, SHA·보고서 경로가 실제 GitHub 사용자 인증, CI 실행, Git main 반영을 암호학적으로 증명하지는 않는다. E3/E5가 Git/CI 영수증과 사용자 승인 여부를 외부에서 대조해야 한다. 앱이 독자적으로 승인/반영하지 않는다.

데이터를 수정해야 한다면 기존 제안을 바꾸는 대신 새 `proposalId`와 `supersedesProposalId`를 사용한다. 사건 순서와 이전 증거는 유지한다.

## 4. 기존 외부 라이브러리에 저장

권장 위치: **`reports/development/ui/review-records/<proposalId>.json`** (외부 `PandoLab-library-data`, Pando 코드 저장소 아님). `tools/report-paths.mjs`의 `reportPath(...,{access:'read'|'write'})`, 기존 라이브러리 쓰기 lease, `reports:publish`/`reports:check` 절차를 그대로 사용한다. JSON 배열에 이벤트를 추가하는 것은 도메인상의 append-only이며 동시 쓰기 충돌 방지/실제 보관은 Git 원문 버전과 기존 라이브러리 절차가 담당한다.

공통 코드: [review-change-records.js](../../shared/frontend/js/modules/review-change-records.js)

- `createReviewBundle(proposal)`: 새 불변 제안.
- `normalizeReviewBundle(bundle)`: 엄격한 스키마·기간·근거·이벤트 순서 검증.
- `appendReviewEvent(bundle,event)`: 기존 제안을 변경하지 않고 새 이벤트 추가.
- `reviewState(bundle)`: 현재 상태/최신 검증/기록된 반영 SHA.
- `indexReviewHistory([bundle,...])`: 원본 국가 ID·속성·기간별 결정적 변경 색인. 좌표 복제 없음.
- `serializeReviewBundle(bundle)`: 재검증한 JSON 파일 내용과 개행.
- `node tools/review/validate-review-bundle.mjs <review.json>`: 파일을 수정하지 않는 검증 CLI.

E2는 실제 데이터 리비전 비교·CI 자동 차이 추출(E3), 지도 검수 UI(E4), Windows 실제 검수 앱(E5), Android 유지보수(E6에서 제거)까지 구현하지 않는다. 새 역사 GIS 사건·명칭·국기·국경과 자료 핀을 임의로 생성하지 않는다.
