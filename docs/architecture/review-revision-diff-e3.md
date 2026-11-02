# E3 — 실제 GIS 리비전 비교·검증 산출물 자동 생성

**대상 브랜치:** `work/ui`  
**선행:** [E2 검수 이력 계약](review-change-history-e2.md)  
**후속:** E4 웹 검수 UI · E5 Windows 검수 앱

## 1. 실제 정본과 비교 축

E3가 비교하는 것은 Web/App 코드가 아닌 외부 데이터 저장소 **`kimjeon-il/PandoLab-library-data`**의 두 확정된 Git 커밋이다.

- 변경 전: `baseRevision` (40자리 SHA). 현재 `work/ui`의 짝지어진 pin은 `5eb7be55208efaafe39bd5a65ec2f111d70b9053`.
- 변경 후: `candidateRevision` (40자리 SHA). 반드시 base의 자손이어야 한다. 별도 브랜치의 단순한 `main` 최신 커밋으로 자동 변경하지 않는다.
- `library.json`의 `entities[entityId]`에 들어있는 원본 JSON SHA-256을 비교하여 **바뀐 객체만 읽는다**. 변경 전후 원본은 각 리비전의 `objects/<sha256>.json`에서 읽고 실제 바이트 SHA-256을 재검증한다.
- 같은 객체 내에서 `geometryVersions`, `nameVersions`, `metadata.flagHistory`, `parentEntityId`, `lifetime`을 독립 비교한다. `sourceInfo`·별칭 등 지도 비표현 메타데이터 차이는 `nonMapMetadata`에 구별해 기록한다.
- 한 데이터 리비전에서 1914→1915년으로 이동하는 **역사적 시점 비교**와, 두 데이터 리비전의 같은 1914년을 비교하는 **제작 변경 추적**은 서로 다른 축이다. E3는 후자만 증거화하며 `comparisonMonth`에서 보여줄 변경 수만 선택적으로 계산한다.

**형상/국기 원본의 복제 금지:** GeoJSON 정점이나 SVG/Base64를 검수 제안서에 삽입하지 않는다. 형상 원본 JSON을 정확한 순서로 직렬화해 해시하고, 기존 `versionId`를 참조한다. 내장 SVG는 디코딩한 이미지 바이트를 해시한다. 외부 플래그 경로의 실제 바이트를 읽을 수 없다면 `unresolved-flag-artwork` 문제로 기록하고 정확한 해시를 만들어낸 척하지 않는다.

## 2. 시간 대응과 오류 처리

국가/영토의 유효기간은 C++ Core가 제공하는 `parseTemporal`, `normalizeTemporalInterval`, `temporalIntervalsOverlap`, `temporalFollowingDay` 등의 기존 함수를 사용해 검증한다. E2 `validFrom`/`validTo`의 **year/month/day 원래 정밀도와 양끝 포함 규칙**을 유지한다.

후보 리비전의 날짜별 형상/명칭 에디션을 우선 사용하고, 변경 전 기간이 그 에디션 전체를 명확히 포괄하는 경우에만 before/after를 구성한다. 기존 전체 기간이 후보 여러 기간으로 분리되는 경우 인접일 연결성을 점검한다. 시작·종료가 부분적으로만 겹쳐서 의미를 확정할 수 없는 변경은 날짜를 임의로 쪼개지 않고 `unaligned-interval` 또는 `coverage-gap`을 기록한다. 거짓 변경 건수를 만들지 않는다.

1회 비교는 기본 최대 **50개 변경 객체**로 제한한다. 대량 리비전은 무한 메모리 작업을 하지 않고 정해진 범위로 분할해야 한다. 원본 국가 ID `state:...` 외 객체(하천·호수 등)는 현재 E2 국가 계약의 범위 밖이며, 그런 객체의 변경은 `unsupported-object-domain`으로 남겨 별도 정책을 요구한다.

서로 다른 Git 리비전이지만 `library.json` 국가 원본에 차이가 없는 경우에도 성공적인 **`no-map-changes`** 산출물을 작성한다. 연구 보고서만 추가된 것을 국경 변경으로 취급하지 않는다.

## 3. 자동 생성 파일과 완료 의미

실행 도구: [e3-revision-diff.mjs](../../tools/review/e3-revision-diff.mjs), [generate-e3-review.mjs](../../tools/review/generate-e3-review.mjs). 둘 모두 기존 저장소의 **read-only Git 입력**을 소비한다.

| 파일 | 내용 |
| --- | --- |
| `e3-source-diff.json` | 객체별 실제 변경 전후 SHA, 원본 값, 역사적 유효기간, 해당 월말 관련 변경 수, 미대응 구간 |
| `e3-verification.json` | 검사별 실제 실행 상태, 표본 범위, 역사 정확도 미검증 여부 |
| `e3-pending-proposal.json` | 검증된 근거 보고서를 명시한 경우에만 E2 계약에 따라 생성되는 미승인 제안서. 상태 `pending`; `events:[]` |
| `e3-output-manifest.json` | 산출물 파일·크기·SHA-256·기준 코드/데이터 커밋, 상태 요약 |

**중요:** 기계가 검증한 것은 Git 원본의 hash/스키마/시간 계약이다. 전체 인접 국경의 위상 검증 `geometry-topology`은 이번 단계에서 실행하지 않았으므로 `not-run`. 역사적 출처의 독립 검증도 자동으로 `passed`로 처리하지 않고 `historicalAccuracy:not-verified`를 기록한다. E2의 `approved`/`applied` 이벤트는 E3가 생성하지 않는다. CI에서 만들어진 제안서의 생성 주체는 `automation`으로 구별하며, 실제 사람/AI 작성자로 허위 표기하지 않는다.

**증거의 보존:** CI의 증거 ZIP은 14일 보존되는 GitHub Actions artifact다. 영구 보존이 필요하면 기존 라이브러리 `reports/development/ui/review-records/`에 해당 JSON 원문을 저장하고 Pando의 `reports:publish`/`reports:check` 절차로 원격 보관 및 SHA 대조를 해야 한다. E3 수용 CI는 쓰기 권한이 없는 소스 검사이며, 실제 원본·보고서를 자동 공개/승인하지 않는다.

## 4. 실제 수용 오라클 (아바가이투 2008)

고정 비교:

- `base=5eb7be55208efaafe39bd5a65ec2f111d70b9053` (`work/ui`의 기존 데이터 pin)
- `candidate=a36bf7621a0cc72267415be19562cc78d3fc725d` (검토·적용된 후속 `work/gis` 데이터 리비전)
- `comparisonMonth=2008-10` (지도 비교는 해당 월말; 원본 국경 사건 날짜는 별도 보존)
- 근거: [아바가이투 G 후보 연구 README-ko.md](https://github.com/kimjeon-il/PandoLab-library-data/blob/a36bf7621a0cc72267415be19562cc78d3fc725d/reports/borders/reconstruction/abagaitu-g-geographic-candidate-2026-11-01/README-ko.md)

`library.json`에 의해 실제 변경된 원본 객체는 `state:CHN`, `state:RUS` 두 개다. 데이터 원본 비교에서 **4건의 E2 형상 변경 슬롯**을 발견했고, 구간 미대응 `issues: 0`으로 판정했다.

| 원본 객체 | 변경 필드 | 정확한 역사적 적용 구간 |
| --- | --- | --- |
| `state:CHN` | `geometry` | 시작 제한 없음 ~ `2008-10-13` |
| `state:CHN` | `geometry` | `2008-10-14` ~ 종료 제한 없음 |
| `state:RUS` | `geometry` | `2008-10-14` ~ `2014-03-17` |
| `state:RUS` | `geometry` | `2014-03-18` ~ 종료 제한 없음 |

표의 구간은 원본에서 확인한 **지도 형상 에디션의 유효기간**이다. 각 행을 별개의 영토 이양 사건이나 그 날짜의 역사적 합의로 단정해서는 안 된다. 특히 2014년 이후 러시아 형상은 적용 시점이 있다는 정보일 뿐, 영유권·승인 상태에 대한 정치적 판단을 의미하지 않는다.

최종 수용 실행: [GitHub Actions E3 실제 데이터 검증](https://github.com/kimjeon-il/Pando/actions/runs/41376142774), Pando 코드 기준 `247480803aa525343d6284eb3cc8fd1f38de5cf7`. 두 Job 모두 success: **E3/E2 계약 단위 테스트 18개 통과**, 실자료 원본 비교·검증/제안 JSON 생성·E2 계약 재검사·artifact 보관 성공. 결과 파일: [E3 실제 비교 증거 ZIP](https://github.com/kimjeon-il/Pando/actions/runs/41376142774/artifacts/13111775401). 생성 제안은 `e3-abagaitu-2008-g-41376142774`, `createdBy: automation`, `status: pending`, `events: []`이며 승인·적용되지 않았다. 역사지리 정확성은 `not-verified`, 전체 인접 국경 위상 검증은 `not-run`으로 기록했다. 이 작업은 실제 원본 GIS 데이터나 외부 자료 저장소의 최신 리비전을 수정하지 않았다.

## 5. 직접 실행 방법

기존 `work/ui` 워크트리에서 외부 라이브러리 정본을 준비한 후, 기존 `.library-data/repository` checkout으로 원하는 자료 revision을 좁게 fetch한다. 관련 원본 객체/보고서만 on-demand 읽으며 GIS 전체 파일을 복제하지 않는다.

```bash
node tools/library-data.mjs
git -C .library-data/repository fetch --no-tags --filter=blob:none origin a36bf7621a0cc72267415be19562cc78d3fc725d

node tools/review/generate-e3-review.mjs \
  --data-root=.library-data/repository \
  --base=5eb7be55208efaafe39bd5a65ec2f111d70b9053 \
  --candidate=a36bf7621a0cc72267415be19562cc78d3fc725d \
  --comparison-month=2008-10 \
  --code-revision=<현재 work/ui 40자리 SHA> \
  --evidence-path=reports/borders/reconstruction/abagaitu-g-geographic-candidate-2026-11-01/README-ko.md \
  --proposal-id=<이 실행만의 고유 ID> \
  --created-at=<UTC ISO millisecond 생성 시각> \
  --output-dir=<현재 작업에서 승인된 출력 폴더>
```

자동 수용 CI: [.github/workflows/e3-revision-comparison.yml](../../.github/workflows/e3-revision-comparison.yml). 검증은 Pando에서만 수행하고 외부 데이터 repo에는 테스트·CI·코드를 추가하지 않는다.

E4는 E3 산출물과 E2 객체별 색인을 웹 검수 화면에 연결한다. E5는 Windows 검수기에서 이 동일한 읽기·검수 경계를 재사용한다. E6까지 기존 편집 코드/Android 네이티브 코드는 삭제하지 않는다.
