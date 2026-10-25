# 도시 지명 16차 이후 대량 조사·검증 절차

대상: 웹 저장소 `work/places`의 `reports/places/tier1-major-cities-batch*.json` (역사적 지명 조사본). 기존 1~15차 데이터와 `main`, 지도 런타임/타일/배포 manifest는 건드리지 않는다.

## 역할 구분

- `tools/build-place-candidates.mjs`: 공식 GeoNames 스냅샷으로 현대 정착지 후보 추출과 ID별 유지/보류/제외 검토. 이 도구의 `candidate()` 포함 정책을 변경하지 않는다.
- `tools/place-batch-pipeline.mjs`: 검토된 후보 풀에서 *미등록 ID* 선별, 출처 해시 대조, 조사 대기열 출력, 역사 명칭이 조사 완료된 JSON의 기계적 검증 및 **새** 차수 파일 생성.
- 연구자/검수자: A(단순)·B(공통 규칙)·C(복잡) 구분과 실제 명칭·날짜·공용어·근거 검증. 이 판단은 GeoNames의 국가·인구·코드만으로 자동화하지 않는다.

## 작업 명령

저장소 루트에서 실행한다. 배치 계획·검증은 프로젝트에서 고정한 Node.js 24를 사용한다. 공식 GeoNames 후보 생성기 `build-place-candidates.py`는 아직 Python을 사용한다.

```sh
# 1. 기존 배치의 등록 수·연혁 수·ID 중복 점검
node tools/place-batch-pipeline.mjs audit

# 2. 기존 확인·보류 판정까지 반영된 공식 후보 풀을 생성 (검증된 .cache 원본 필요)
node tools/build-place-candidates.mjs review

# 3. 16차의 조사 대상 최대 25개를 중복 없이 선별 (전 세계 / 현대 인구 기반 발견 순서)
node tools/place-batch-pipeline.mjs plan --batch 16 --limit 25 \
  --output reports/places/batch16-research-queue.json

# 특정 현재 국가 코드에 한정하려면 --countries TR,IR,SA 등의 옵션을 추가한다.
# 4. 역사 자료를 조사하여 검증된 v6 records[] JSON을 별도 준비한 뒤 검사한다.
node tools/place-batch-pipeline.mjs finalize \
  --input reports/places/.cache/batch16-reviewed.json \
  --output reports/places/tier1-major-cities-batch16-reviewed.json --check

# 5. 모든 쟁점을 확인한 뒤 --check를 빼고 새 차수 JSON을 생성한다.
node tools/place-batch-pipeline.mjs finalize \
  --input reports/places/.cache/batch16-reviewed.json \
  --output reports/places/tier1-major-cities-batch16-reviewed.json

# 6. 독립 단위 검사
node --test tests/unit/place-batch-pipeline.test.mjs
```

`plan`은 출력 경로를 생략하면 결과 JSON을 터미널에 출력한다. 정상 상태에서 `.cache/refined-candidates.ndjson`이 없으면 `review`를 먼저 실행해야 한다. `.cache`의 검증된 ZIP 소스 자체가 없는 환경에서는 기존 `fetch`→`build`→`review` 순서를 적용하되, 원본 스냅샷이 바뀌면 기존 판정 근거·해시를 먼저 재검토한다. 임의의 후보 파일을 시험할 때만 `--candidates ... --skip-source-hash-check`를 사용한다.

`plan`에 들어 있는 `status=unreviewed-candidates-not-city-approval`, `difficulty=unclassified`는 그대로 승인/배포할 수 없다. 현 GeoNames 국가 코드는 출처의 현재 국가일 뿐 역사적 소속·원어·도시 성립·등급의 근거가 아니다. 수도 코드를 우선하고 나머지는 *현재 출처 인구* 내림차순으로 조사 순서를 정하지만 **역사적 도시 등급이나 인구 순위를 부여하지 않는다.**

## 조사 후 확인 항목

- ID가 독립된 취락을 가리키는지, 이미 등록된 도시·구/읍/동·시설과 혼동하지 않았는지 확인한다. 미확인 사례는 대기열에 남긴다.
- 각 유효 기간에는 한국어·영어·원어의 실제 선택명을 기록하고, *이전 기간과 값이 달라진 슬롯만* 바꾼다. 동일 시기 서로 다른 공식 원어명을 최대 세 개까지 인정할 수 있다. 미선택 별칭이나 임의 전사형을 `names[]`에 추가하지 않는다.
- 법정 개칭과 한국어 지도 편집상의 전환, 문자개혁, 장기적 통치권 변화, 단기 점령을 분리한다. 실제 이름 변화가 없으면 불필요한 사건을 만들지 않는다.
- `fromDate`는 그레고리력의 확정된 정확한 시행일에만 사용한다. 연도만 알면 `fromYear`를 사용하며 1월 1일을 임의로 가정하지 않는다. 같은 해에 정확한 날짜의 사건 여러 개가 있으면 연대기순 기록이 가능하되 `fromYear`와 정확한 날짜가 같은 해에 혼재하면 보류한다.
- `shortDescriptionKo`는 28자 이내. `sourceUrl`은 도시 원본과 모든 새 연혁 항목에 HTTPS 출처를 기록한다.
- 도시의 역사적 존재·사라짐(`temporalEligibility`), 인구·도시 등급(`rankTimeline`), 국가 영토·국경은 `displayTimeline`과 별도 검증 대상이다. 값을 모른다고 자동 추정하거나 하위 등급에 배정하지 않는다.

## 안전 장치와 한계

`finalize`는 중복 ID, 새 차수 번호 중복, 좌표, 단계별 명칭 일관성, 실재하지 않는 날짜, 출처 필드, 최신 기본명 불일치 등을 검사하며 **기존 파일에 덮어쓰지 않는다.** 1~15차에는 과거 형식 차이가 있어 기존 자료를 새 기준으로 강제 재작성하지 않는다. 도구가 확인하는 것은 데이터 계약의 일관성이지 역사적 주장의 진위가 아니다. 조사 출처의 실물 확인과 역사적 의사결정은 계속 필요하다.

차수 파일은 검증된 *조사 스테이징* 자료로만 생성된다. 이 명령들은 지도 표시 데이터, 배포 manifest, 앱 저장소, `main`을 변경하지 않는다. `work/places`에 대한 커밋 및 이후 다른 브랜치/앱 통합은 별도 검증과 승인 범위에 따른다.


## 2026-10-11: 1~22차 지명 264건 실행 데이터 생성

- 출처: `reports/places/tier1-major-cities-batch*.json` 22개(264개 고유 GeoNames ID, 명칭 구간 482개). 각 배치 JSON은 변경하지 않는다.
- 정식 웹 데이터: `assets/data/places/reviewed-records-v1.json`, `places-v1.bin` (PLAC v3, 76,922 bytes), `manifest.json` (검색 접두어 608개). 샤드 SHA-256: `68aff90d19dcad210c9b173bf8918d95ad186075595e807e6406cd94f2c64af6`.
- 현재 규모에서는 264개를 1개 tile에 담았다(최대 512개). 새 차수로 한계에 접근하면 다단계 공간 분할/검색 샤딩으로 이관해야 한다. 전체 도시를 DOM/프로젝트 상태에 적재하지 않는다.
- 재생성: `pnpm build:places`. 무변경 재생성 및 실제 PLAC 디코딩/검색 검사: `pnpm check:places`.
- Worker 쿼리는 시대별 한국어/영어/원어(최대 세 개) 표시명을 선택하며 과거 선택명도 검색한다. 웹 라벨은 지도 월말 시점을 전달받아 `displayTimeline`에서 표시명을 고른다. 앱은 동일한 Git blob의 바이너리와 manifest를 번들한다.
- 의심스러운 취락·행정 객체 및 자동 포함 정책 밖의 8개 레코드는 데이터에 보존하되 `town`으로 처리하며 임의의 최종 5단계 도시 등급을 부여하지 않는다. 등록 자체가 역사 좌표·국가 소속 승인이라는 뜻은 아니다.
- 확인되지 않은 현재 영어/원어 슬롯 6건은 추측으로 채우지 않고 공란을 유지한다. 단일 1801년 명칭은 완전한 역사상 불변 확정이 아닌 잠정 표기일 수 있다.
- `temporalEligibility`·연구 근거·`historicalGeography`는 조사본과 JSON 카탈로그에 보존했다. **PLAC v3 바이너리에는 도시 소멸·재건 기간 및 5등급 중요도 자료를 직렬화하지 않는다.** 실제 적용은 별도 계약 확장이 필요하다.
- GeoNames 원천은 CC BY 4.0이므로 출처·라이선스 귀속이 필요하다. 현재 국가코드로 과거 국가 소속·행정 경계를 결정하지 않는다.
- GitHub `work/places`에 저장했다고 공개 사이트에 배포된 것은 아니다. 웹 `main` 통합과 실제 배포·앱 릴리스는 별도 검증 및 승인된 절차를 거친다.
