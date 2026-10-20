# 2026-10-20 UTC GIS 후속 검토 — 벡터 후보와 원문 부재 보류

> 보고서 ID: `GEO-REVIEW-20261020-FOLLOWUP` · 상태: `investigating` · 지도 반영: `not-applied`
> 실제 검토·색인·외부 열람: 2026-10-20 UTC / 2026-10-21 한국 · 신규 원보고서 회차일: 2026-10-21
> 원문 최종 수정: 2026-10-20 UTC
> 기준: `kimjeon-il/Pando` `work/gis` [`e5b31d700fb6a9e2e2b0ab67356b3883011f22c3`](https://github.com/kimjeon-il/Pando/commit/e5b31d700fb6a9e2e2b0ab67356b3883011f22c3), 웹·앱 동일 저장소 revision
> 이전 처리: [`310ee5e674c43cc434f154886da254b2038148a4`](https://github.com/kimjeon-il/Pando/commit/310ee5e674c43cc434f154886da254b2038148a4)의 [10월20일 아침 검토](morning-2026-10-20.md) · [이번 증거 JSON](followup-2026-10-20-vector-sources.evidence.json)

## 결과와 수정 범위

**국가 lifetime·형상·타임라인 정본 적용 0건, 신규 역사 사건 확정 0건.** 신규 GEO-TIME-005 벡터 후보 보고서 1개를 검토하고 누락된 README·연도별 진행 연결을 보완했다. 원보고서에 후보의 권리·판본·시간 의미·검사 한계를 추가하고 국경 통과지점 안내지도와 경계선 자료를 구분했다.

다른 대화에서 작성·등록 거절됐다고 전달된 **GEO-TIME-004와 GEO-TIME-HANDOFF는 각각 `missing-source`로 기록**한다. 원문·출처·정확한 거절 사유 및 원래 GitHub 쓰기 실행 여부는 확인할 수 없다. 해당 문서 재생성·재전송·거절 동작 재시도는 하지 않았다. 이는 기존 GEO-TIME-002 본문 부재와 별개다.

## 최신 지침·원격·중복 확인

기존 `/workspace/Pando-gis` 상설 체크아웃이 `work/gis`, HEAD `310ee5e6`, 미커밋·미추적 변경 없음임을 확인했다. fetch 결과 원격은 `e5b31d70`이며 0/51 뒤처짐이었다. 같은 원격 `work/gis`로 fast-forward만 수행했다. 기존 `/workspace/Pando`의 `work` 체크아웃과 동시 작업을 보존했고 별도 브랜치·채팅 생성이나 보관 복원은 하지 않았다.

루트 AGENTS·브랜치 정책·보고서 README/TEMPLATE 및 최신 [역사 경계 정책](../../../docs/historical-border-reconstruction-policy.md)과 [벡터 자료 운영 규칙](../../../docs/historical-vector-source-workflow.md)을 읽었다. 저장소 `.agents/skills`·하위 AGENTS는 없고 `/workspace/.agents`도 비어 있다. 새 정책은 다음 원칙을 요구한다.

- 사건 장소·실제 효력일에 맞는 SHP/GPKG/GeoJSON/WFS 후보를 먼저 탐색하고 판본·권리·CRS·범위를 기록한다.
- 원본과 파생본을 구분하고, 원본 CRS를 모르면 좌표계 지정을 재투영으로 가장하지 않는다. 독립 사료 두 개 대조·역사 귀속·위상 검증 전 후보를 정본에 넣지 않는다.
- 조사 정상 종료는 후보·검증/보류 기록 저장이며, 국가 존속기간 순환이나 별도 해안 조사를 벡터 수집으로 대체하지 않는다. 최신 정책 자체는 외부 형상 적용 근거가 아니다.

| 변경 자료·정본 경로 | 원본 커밋·이번 판정 |
| --- | --- |
| [벡터 자료 운영 규칙](../../../docs/historical-vector-source-workflow.md) | 추가 `ba333eee7be941b23a21844b36a2363ecb1fe159`, 경로 명확화 `da9c9dccad823e5966a74e9ea64bbb4a387dba2c`. `work/gis/reports/`라는 폴더가 아니라 `work/gis` 브랜치의 루트 `reports/geography/`가 정본. |
| 역사 경계 정책 0절 | `ae5275356b1dc616e1b0dc462b394ea17a699284`의 벡터 우선 탐색 추가. 기존 역사 귀속·0.5px 기준은 유지. |
| [GEO-TIME-005](../historical-timeline-2025-central-asia-vector-screen-2026-10-21.md) | 추가 `e5b31d700fb6a9e2e2b0ab67356b3883011f22c3`; 파일 회차는 10-21, 원격 커밋은 10-20 UTC. GEO-TIME-001 사건의 후속 자료 후보이며 신규 사건이 아님. |

이전 증거가 열거한 28개 국가·시대별 문서/진행기록은 **310ee5e6에서 처리된 최종 blob 기준으로 모두 동일**하며, 새 005를 포함해 29개를 비교했다. 기존 검토 보완 전의 원본 blob과 혼동하지 않았다. 이전 아침 검토 자체도 바뀌지 않았다. 개발 보고서와 README 개발 색인 추가는 GIS 신규 조사로 재집계하지 않는다.

## 벡터 후보의 직접 확인과 기존 보류

새 005가 참조한 공개 목록·API **5개 고유 URL**(LSIB 1, geoBoundaries 2, CShapes 1, 키르기스 지도 1)의 본문을 확인했다. 같은 LSIB 원문의 권리·배포 필드 재조회는 별도 출처로 세지 않는다. 후보의 정확한 필드와 한계는 [원보고서의 후속 표](../historical-timeline-2025-central-asia-vector-screen-2026-10-21.md#후보-메타데이터-후속-검토)에 기록했다.

- [LSIB 공식 목록](https://catalog.data.gov/dataset/large-scale-international-boundaries)은 11.4 발행일과 전체 ZIP·데이터 전용 GPKG 제공을 뒷받침한다. `SHP ZIP`의 실제 내부 구성은 검사하지 않았으므로 한정했다. 미국 정책상 경계 표현과 실제 통제선, 발행일과 구간의 유효일을 구분했다. CC0·`restricted public`·`rights=copyright`의 원문 표기를 기록하고 배포 승인으로 해석하지 않았다.
- geoBoundaries [KGZ](https://www.geoboundaries.org/api/current/gbOpen/KGZ/ADM0/)·[TJK](https://www.geoboundaries.org/api/current/gbOpen/TJK/ADM0/) API의 2017 표현연도와 2023 원자료 갱신·빌드를 구분하고 각 ODbL 1.0을 기록했다. 메타데이터의 boundaryID는 실제 파일의 속성 ID 검증과 다르며, 2025년 조약 경계로 사용할 수 없다.
- [CShapes 공식 페이지](https://icr.ethz.ch/data/cshapes/)의 세계 1886–2019 범위·CC BY-NC-SA 4.0을 확인했다. 2025 대상 연도 밖이며 파일별 판본 검증은 하지 않았다.
- [키르기스 정부 지도](https://gps.gov.kg/wp-content/uploads/Digital-maps/en/index.html)는 국경 통과지점 안내지도다. 공개 페이지 제목·설명만으로 조약 경계 벡터가 확보됐다고 하지 않는다.

이들 후보는 2025 양자조약의 인증된 부속 경계 좌표·구간 인계·효력일을 제공하는 새 원전으로 확인되지 않았다. KGZ/TJK 양자조약과 KGZ/TJK/UZB 접점 조약의 기존 보류를 해소하지 않는다. IRQ/JOR/LBN, ERI/GNB/SEN 및 미주 8개국의 국가 동일성·최초 존속일 보류도 관련 새 법적 근거가 없어 유지한다. 조사 하한 1801-01-01을 건국일로 넣거나 사건 서명일을 형상 유효일로 적용하지 않았다.

## missing-source와 접근 제한

사용자가 제시한 [원래 대화 참조](https://chatgpt.com/c/6ad0d979-fc70-83e8-8629-d26dfa23b685?messageId=38d806eb-b6b0-43f8-ba97-27364135e829)는 일반 열람에서 **로그인 화면만 반환**해 본문·거절 결정문이 보이지 않았다. Personal Context 조회는 **“Personal context is unavailable for this conversation.”**으로 실패했다. 로그인 우회·다른 계정·새 채팅·보관 복원은 시도하지 않았다.

| 보류 대상 | 확인된 상태 | 미확인 사항·다음 검토 조건 |
| --- | --- | --- |
| `GEO-TIME-004-2025-palestine-chagos-2026-10-20.md` | 사용자 전달: 다른 대화에서 작성 후 GitHub 반영이 안전 검토에서 거절됨. 현재 work/gis 트리·조회한 이력·두 체크아웃에는 본문 없음. **missing-source** | 문서 원문·출처·대상 객체·사건/효력일·정확한 거절 사유 및 쓰기 실행 여부 모두 미확인. 제목으로 역사 주장을 추정하지 않음. |
| `GEO-TIME-HANDOFF-2026-10-20.md` | 위 전달과 원문 부재를 별도 문서로 기록. **missing-source** | 인계 내용·거절된 작업의 대상/이유/실행 여부 미확인. 동일 동작을 다른 쓰기 도구나 새 파일로 재현하지 않음. |
| `GEO-TIME-002` | 기존 연도별 기록의 본문 부재 보류 유지 | 위 두 파일로 복구되었다고 세지 않음. 새 원문·복구 근거 없음. |

원문·거절 사유가 확보되기 전 두 문서의 등록/재시도는 중단 상태다. 기존 쓰기가 실행되지 않았다는 사실도 이번에는 확정할 수 없으므로 재시도 조건을 충족하지 않는다. 위 보류 기록은 거절된 문서의 복원본·대체 역사 보고서가 아니다. **이번 저장소 fetch·문서 검토 기록의 commit/push 결과는 별도 확인**한다.

## 현행 데이터·실제 검증 범위

`assets/data/territorial-entities` 트리는 이전 검토와 이번 기준 모두 **`b36a4ddca401ab343e2d5e5f170ccca185e35243`**, 생성 색인 blob은 **`a26630cd820eb2ec05e1c87fb847aa8cdcf3dacf`**로 동일하다. 현행 281객체/262계보 및 2026-10-06 스냅샷을 확인했다. 추가 원본 변경·재생성은 하지 않았다.

집중 대상 KGZ/TJK/UZB 3객체의 원본·생성 색인·gzip 핵심 필드·형상 메타데이터 및 원본/청크 형상 내용, 압축 SHA-256·바이트 수를 대조했다. KGZ/UZB의 기존 국가 시작일은 1991-08-31, TJK는 null이고, 각 Natural Earth 5.1.1 현대 형상 1개·기간 양끝 null·`datePrecision=current`로 서로 일치했다. 기존값을 덮어쓸 근거는 없다.

실행: 최신 원격·깨끗한 작업 트리·지침 확인, 29개 문서 경로/blob/이력 비교, 라이브러리 트리 동일성 및 3객체 집중 검사, 위 5개 외부 원문과 접근 실패 확인. 변경 Markdown 상대 링크 **150개**, JSON·수량·원본 revision·허용 파일 **5개** 제한·색인 중복 부재·동시 개발 색인 보존·진행 커서 불변 및 `git diff --check` 검사가 통과했다. 통과 수는 증거 JSON에 기록했다. 커밋 직전 원격을 재조회하고 일반 push 뒤 원격 SHA를 확인하며 최종 결과는 이 보고서를 포함한 커밋과 응답으로 추적한다.

미실행: 외부 벡터 원본 다운로드·파일 해시/CRS/레이어/형상/위상 검사·변환, 독립 역사 기준과의 0.5 CSS px 화면 검사, 웹·앱 빌드·전체 테스트. 후보 메타데이터 보완만으로 해당 검사를 통과했다고 표시하지 않는다. `main` 병합·배포·포터블 패키지·중단된 무명 수계 조사는 범위 밖이며 실행하지 않았다.

연도별 커서는 2025년 잠정·전수 미완료로 유지하고 국가 존속기간 순환의 오세아니아 차례도 변경하지 않는다. 이번 문서는 신규 005의 일부 후보 메타데이터 검토와 원문 부재 기록이며 이전 아침 보고서·원본 연구 전체를 대체하지 않는다.
