# 지명 웹·앱 동기화용 계약 v2

웹의 `data/places-tier1-major-cities` 브랜치는 지명 검수 원본과 실행용
데이터 계약의 소유자이다. 앱은 별도의 Qt/C++ 구현을 유지하지만,
데이터 의미·직렬화·언어별 표시 규칙은 동일한 결과를 만들어야 한다.

## 명칭 선별 기준 (정책 확정, 데이터 정제는 별도 단계)

- 하나의 지명 ID와 지도 시점에서 **한국어(ko)·영어(en)·원어(native)의 대표명은 각각 최대 하나**다. 확인되지 않은 이름은 채워 넣지 않는다.
- **원어명은 해당 시점의 통치국 또는 관할 행정기관이 실제로 공식 사용한 도시명**을 기준으로 선정한다. 중앙정부 주류 언어와 지역 공식 언어가 다르면 해당 지역의 공적 명칭을 확인하며, 복수 공용어는 대표 원어 하나를 선정하고 나머지는 근거 있는 예외로만 보존한다.
- **영어명과 한국어명은 선정된 원어명에 대응하는 동시대 명칭**으로 정한다. 널리 사용되는 영어·한국어 외칭은 허용하되 반드시 직역·음역일 필요는 없으며, 서로 다른 시대의 도시명 번역을 혼합하지 않는다.
- 통치국 변경은 원어명 재검토 사유일 뿐 자동 개칭 조건이 아니다. 원어명이 실제로 바뀐 경우 영어·한국어 대응명을 다시 검토하고, 한국어 편집 규칙만 바뀌었다면 한국어명만 변경한다.
- 구어·별칭·낡은 로마자 표기·중복 외칭은 기본적으로 미수록한다. 검색에 꼭 필요한 비대표명이나 실증된 복수 공용어는 사유·언어·근거를 기록한 **승인 예외**로만 취급하며, 지도 대표명에는 추가하지 않는다.
- 중국 대륙의 중국어계 지명은 **중화민국 건국일 1912-01-01**을 경계로 한국식 한자음 → 중국어 발음 기반 한국어 표기를 적용한다. 이는 실제 중국 지명 개칭이 아닌 한국어 지도 편집 규칙이며, 옛 한자음은 시대별 한국어 역사명으로 분류한다. 일본 지명은 한자음 별칭을 별도로 저장하지 않는다.
- 규칙 정본: `reports/places/historical-display-policy.json`, `reports/places/korean-map-label-policy.json`. 이번 개정은 정책만 변경하며 검수 배치·타일·렌더러·기존 테스트 기대값은 바꾸지 않는다.

## 범위별 정본 및 책임

| 영역 | 웹 정본 | 향후 앱 대응 |
| --- | --- | --- |
| 검수·출처·시대별 대표명·허용 예외 | `reports/places/tier1-major-cities-*.json` | 각 시점 ko/en/native 대표명 최대 1개씩 선별, 승인된 예외만 보존 |
| ID·언어 토글·역사명 | `assets/js/modules/place-contract.js` | PlaceRecord / 순수 이름 선택기 |
| PLAC 바이너리 v2 | `assets/js/modules/place-codec.js` | PlaceRuntimeStore 디코더 |
| viewport·검색·캐시 | `place-worker-store.js`, `place-runtime.js` | 앱 store/provider |
| 사용자 설정/체크박스 | `user-preferences.js`, `app-map-settings.js` | 앱 환경설정/UI |
| 라벨 충돌/표시 | `label-layout.js`, `rendering-domain.js` | Qt 라벨 엔진·서체 계측 |

`assets/js/modules/place-contract.js`는 표시 이름과 바이너리 포맷의
**단일 코드 정본**이다. UI와 환경설정에서 같은 언어 정규화/토글 함수를 사용한다.
포맷 상수를 `place-codec.js` 등에 별도로 하드코딩하지 않는다.

## 기계 판독 가능한 교환 파일

`contracts/places/v2.json`에는 다음 정보를 하나로 묶는다.

- 식별자 `builtin:place:{source}:{sourceId}`, 순위 및 런타임 필드.
- PLAC 타일 v2의 매직·바이트 순서·헤더/레코드 바이트 수·필드별 오프셋.
- `name`(한국어)·`nameEn`(영어)·`nameNative`(선택한 원어).
  원천 자료의 다양한 이름을 정제된 `names[]`에 무제한 이관하지 않는다. 각 시점의 대표 한국어·영어·원어명만 원칙적으로 보존하고, 검색용 별칭·복수 공용어 예외는 근거를 명시한다. 1~15차 기존 검수 파일은 아직 새 기준으로 정리하지 않았다.
- `nameTimeline[]`의 연도 `fromYear`·정확한 날짜 `fromDate`
  구분. 국가 코드·주권 변경만으로 언어/역사명 전환을 추정하지 않는다.
- 독립 언어 체크와 최소 1개 활성 규칙·동일 표기 중복 제거.
- 검증된 데이터 사례에 대한 입력·정규화 결과·원시 v2 타일 hex·
  선택 언어/시점별 기대 행·웹 예상 충돌 상자.

생성기는 사례의 GeoNames ID를 실제 `reports/places/tier1-major-cities-batch*.json`과
대조한다. 검수 원본의 한국어명·좌표·확인된 영어/원어·한국어 역사명 변경이
어긋나면 **생성을 실패**시키므로 검증 자료의 묵은 하드코딩을 발견할 수 있다.

라벨 충돌상자는 웹 CSS 픽셀의 보수적 추정이다.
Qt 글꼴 실측치까지 같다는 뜻이 아니므로 시각적 기하 오차는 별도 검사한다.

## 웹에서 변경 시

```sh
node tools/export-place-sync.mjs
pnpm check:place-sync
node --test tests/unit/place-codec.test.mjs tests/unit/place-names.test.mjs tests/unit/place-layout.test.mjs tests/unit/user-preferences.test.mjs
```

`tools/place-sync-cases.mjs`의 기대 행은 별도로 검수된 고정값이며, 생성기가
현재 코드 동작을 그대로 기대값으로 복사하지 않는다. 생성기는 실측
인코딩·정규화·충돌상자만 갱신한다. CI의 `--check` 단계가 갱신 누락을 탐지한다.
생성 결과는 해당 소스 변경과 **같은 커밋**에 반영해야 한다.

## 나중에 앱에 이식할 때

1. 대상 웹 **커밋 SHA**와 이 커밋의 `contracts/places/v2.json`을 함께 고정한다.
2. 앱 `PlaceRecord`에 언어별 이름과 날짜별 이력을 추가하고 v2 디코더를 작성한다.
3. 동일 JSON의 `fixtures[]`에 들어 있는 **모든 hex 바이트 및 출력 행**을
   C++ 테스트에서 그대로 검증한다. 원본을 변형하거나 테스트 통과를 위해
   기대값을 재생성하지 않는다.
4. 앱 사용자 설정과 렌더링 adapter를 독립 구현하되 언어 선택·중복·
   최소 1개 활성의 의미는 순수 계약대로 유지한다.
5. Qt 충돌상자는 실제 폰트 측정과 웹 예상값 차이를 명시적으로 보고한다.

현재 앱의 `tools/place-runtime-contract/`는 과거 **고정 웹 소스 v1**의
검증 자료이므로 그 원본을 덮어쓰지 않는다. 이번에는 **앱 브랜치를 만들거나
앱 코드를 수정하지 않는다.**

## 아직 완료되지 않은 연결

웹 실제 지명 manifest는 빈 상태이고, 검수 기록을 PLAC v2 타일로 배포하는
빌드 단계는 이 변경 범위 밖이다. 지도 선택 날짜를
`resolvePlaceLabelRows(place, languages, mapDate)`에 전달하는 런타임
연결도 미완료다. 이 둘을 구현하기 전에는 실제 지도 데이터/역사 시점의
웹·앱 동작 일치를 주장해서는 안 된다.
