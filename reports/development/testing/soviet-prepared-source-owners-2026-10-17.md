# OBJ-093 — 공유 국경선 국가별 준비 자료의 참조 소유권과 재사용 비용

> 2026-10-17 · 상태: `verified-source-and-3-isolated-gc-orders`
> 기준 제품: `work/perf-singleton-edges-20261017` `f2370babfccf3dd07dca26f11aeecab4434189ca` (OBJ-092 적용)
> 조사 브랜치: `work/perf-prepared-owners-20261017`
> CI: [실제 소련→현대 준비 자료 독립 GC 세 순서 #39036298519](https://github.com/kimjeon-il/Pando/actions/runs/39036298519)
> **제품 JS·C++/WASM·지도 데이터·`main` 변경 없음.**

## 1. 최신 제품 코드에서 확인한 참조 그래프

`country-shared-boundary-worker.js`의 `boundaryState`가 `preparedStore`를 소유하고,
`createPreparedBoundaryStore()`는 `byId`와 상위 `spatialIndex`를 유지한다.

- `byId`의 국가 준비 객체는 `feature`, `geometry`, `segments`, `bounds`, 국가별 `spatialIndex`, 지연 렌더링 선분 view를 포함한다.
- 상위 `spatialIndex`는 동일한 국가 준비 객체를 인덱싱한다. 별도의 국가별 source segment 전체 사본을 구축하지 않는다. 기존 OBJ-091에서는 254개 prepared geometry가 마지막 메시지 geometry 254개와 모두 동일 객체였다.
- `boundarySourceSegments()`는 원본 geometry 좌표 배열 `a`, `b`를 공유하는 JS source-row 객체를 생성한다. 원본 좌표 외에도 polygon/ring/segment 번호와 winding/interior 정보를 보관한다.
- `createBoundarySpatialIndex().loadPacked()`는 128개 이상 선분의 불변 국가 형상에 TypedArray box offsets, bounds, postings, visited와 cell-offset Map을 보관한다. `packed.values`는 국가 준비 객체의 **동일한** `segments` 배열을 참조하며 복제하지 않는다.
- `country-contact-core.js`는 별도 `wireRows: WeakMap<prepared, [a,b,polygonIndex,ringIndex,segmentIndex][]>`를 유지한다. 이 배열은 C++ 접촉 계산에 쓰며, prepared 객체가 살아 있는 동안 WeakMap 값도 GC되지 않을 수 있다.
- `contacts`의 결과 `refs`는 source row의 일부 필드를 복사해 실제 접촉 source identity/좌표를 보존한다. 국가별 인덱스를 지워도 모든 접촉 refs를 해제한 것과 같지 않다.

**결론:** OBJ-091의 preparedById + upper index 약 79~87MiB는 단일 중복 할당 덩어리가 아니다. 특히 V8 used heap과 TypedArray 바이트, WASM 선형 메모리를 별도 계층으로 구분해야 한다.

## 2. 계측 설계

실제 Chromium 1989-06 소련→2026-10 현대 복귀 후, Worker가 완전히 idle인 상태에서 서로 독립된 브라우저 컨텍스트 세 개를 사용한다.

1. `latestMessage → wireRows → per-country index → segments → feature/geometry → upper index → byId → contacts/edges`
2. `latestMessage → per-country index → segments → wireRows → feature/geometry → upper index → byId → contacts/edges`
3. `latestMessage → segments → per-country index → wireRows → feature/geometry → upper index → byId → contacts/edges`

각 범주 해제 후 CDP Worker GC를 두 차례 수행하고 공유 국경선 Worker V8 used heap, WASM 선형 메모리 및 전체 Chromium PSS를 분리 측정한다. 해제량은 **순서에 종속**되며 독립적 dominator size로 취급하지 않는다.

시험용 hook은 `scripts/research/instrument-prepared-source-owners.mjs`가 **폐기될 CI checkout에만** 삽입한다. 실제 저장소의 제품 소스에는 검사 후의 null, `Map.clear()` 또는 진단용 글로벌이 포함되지 않는다.

## 3. 작업 판정 기준

- OBJ-092의 국가 254, source-row 544,163, shared edge 68,616, contact 339, packed 국가 인덱스 194와 원본/전달 identity 보존 여부를 계측에서 확인.
- `wireRows`만 해제한 단계에서 측정되는 V8 절감량을 우선 파악하고, 이후 별도 A/B에서 잦은 패치가 발생하는 나라의 C++ wire 재생성 CPU 비용을 검사할 것.
- 국가별 압축 인덱스는 **원본 구간 source-ref 검색**에 사용되므로 단순 제거를 제품 개선이라고 판단하지 않을 것.
- `geometry`, `feature`, `latestMessage`는 참조를 공유하므로 별도 독립 복제량으로 합산하지 않을 것.
- 확정된 구조 개선만 별도 제품 커밋·동일 실행기 Worker JS/PSS A/B 및 소련/현대 12회 왕복에서 검증할 것.

## 4. 현재 검증 상태

기존 제품 소스 변경 없이 [독립 Chromium CI #39036298519](https://github.com/kimjeon-il/Pando/actions/runs/39036298519)가 세 순서 모두 통과했다. 다음 제품 최적화는 별도 브랜치에서 CPU 재계산 비용을 A/B로 검증해야 한다.

## 5. Chromium 실측 (2026-10-17, 세 컨텍스트)

실제 1989-06 소련 → 2026-10 현대 복귀 후, 국가 254/접촉 339/edge 68,616,
source rows 544,163, packed 국가 인덱스 194를 모두 확인했다.
`wireRows` 캐시는 **251국가, 519,900개 source row**의 5항목 JS 입력 배열을 보유했다.
국가별 packed TypedArray 바이트 합계는 **23,892,044B (약 22.79MiB)**이며
이 값은 V8 used heap 해제량과 구분되는 저장소 통계다.
마지막 입력·prepared 간 geometry는 254/254 같은 객체다.

| 해제 대상 | wire-first | index-first | segments-first |
|---|---:|---:|---:|
| 초기 공유 국경 Worker JS used heap | 127.39MiB | 127.38MiB | 127.38MiB |
| `latestMessage` | 0.02 | 0.01 | 0.02 |
| `wireRows`의 인코딩 배열 | **23.81** | **23.81** | **23.81** |
| 국가별 index + source-row 배열 합계 | 27.48 | 27.49 | 27.49 |
| 준비 객체 내 feature / geometry / lazy view | 24.65 | 24.64 | 24.64 |
| 상위 국가 공간 인덱스 | 3.21 | 3.21 | 3.21 |
| `byId` Map 자체 | 0.06 | 0.06 | 0.06 |
| contacts 제거 → edges 제거 | 약 46.90 | 약 46.90 | 약 46.90 |
| 전체 그래프 해제 후 | 1.25MiB | 1.25MiB | 1.24MiB |

단위는 각 단계 이후 **Worker V8 used heap 감소 MiB**로, 양수는 현재
테스트 순서에서 해당 참조 해제 직후 회수된 값이다.
위 표의 국가별 index / source-row를 각각 독립 분해하면 인덱스부터 삭제한 경우
**2.01 + 25.48MiB**, source-row부터 삭제하면 **0.01 + 27.48MiB**로 달라진다.
이유는 packed 인덱스가 동일 source-row 배열을 참조하기 때문이다.

`contacts`는 결과 `refs`를 통해 실제 source 좌표를 공유한다.
`edges`는 contacts와 결과 객체 identity를 공유하므로,
각 개별 `Map`의 모든 해제 바이트를 독립 메모리 중복이라고 볼 수 없다.
WASM 선형 메모리는 모든 파괴적 단계에서 불변이며 오류 0건이었다.

**실제 최적화 후보:** `country-contact-core.js`의 `wireRows` 23.81MiB를
C++ batch 호출 생명주기로 축소. 객체/선분 원본 참조와 패치 탐색 인덱스는 그대로
유지하되, 반복 동일 국가 경계 계산에 대한 CPU 성능 A/B가 확보되기 전에는
제품 병합을 승인하지 않는다.
