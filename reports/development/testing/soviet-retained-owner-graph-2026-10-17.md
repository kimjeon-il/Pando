# OBJ-091 — 공유 국경선 Worker 잔여 보유 객체 소유권 분해

> 조사일: 2026-10-17 · 상태: `verified-isolated-chromium` · 제품 변경: **없음**
> 기준 소스: `main a417b3f1242edf2a7ab639903a1ba3c6817ba66d` / OBJ-090 최종 병합 버전
> 조사 브랜치: `work/perf-retained-owners-20261017` · [격리 계측 CI](https://github.com/kimjeon-il/Pando/actions/runs/39032118412)

## 출발 기준과 계층 구분

기존 OBJ-089/OBJ-090의 압축/지연 선분 계산 후 현재 소련 1989-06 → 현대 복귀 Worker JS used heap은
동일 러너 비교에서 **133.41MiB**, Worker WASM 선형 버퍼는 **57.63MiB**였다.
OBJ-088의 **101MiB**는 과거 360MiB 상태에서 나머지 필드를 파괴적으로 해제한 뒤
`boundaryState` 전체를 제거할 때의 **조건·순서 종속 GC 해제량**이다.
현재 133MiB에서 곧바로 독립된 'contacts 101MiB'로 귀속하거나 메모리를 차감하면 안 된다.

현재 제품의 유지 객체는:
- `boundaryState.contacts`: 나라 쌍마다 원본 경계 분할 선분을 보유.
- `boundaryState.contactsByOwner`: 위 접촉의 소유 국가별 역참조.
- `boundaryState.edges`: 좌표 단위 키로 정리한 화면 공유 경계 결과와 각 접촉의 기여 자료.
- `preparedStore.byId`: 국가별 원본 형상/선분/압축 공간 인덱스.
- `preparedStore.spatialIndex`: 국가 후보 조회용 상위 공간 인덱스; 대부분 `byId`의 준비 객체를 *참조*함.
- Worker `latestMessage`: 마지막 형상 입력. 준비 상태와 같은 지오메트리를 공유할 수 있어 중복 독립 heap이 아님.

## 수행 방법

`scripts/research/instrument-shared-boundary-retainers.mjs`는 **GitHub Actions의 폐기되는 checkout 안에서만**
기존 팩토리 함수의 내부 Map을 검사할 수 있는 객체를 임시 반환한다.
**저장소에 커밋한 제품 JS, C++/WASM, generated-world 데이터, `main`은 변경하지 않는다.**
계측 후에는 브라우저 컨텍스트를 폐기한다.

`tests/browser/soviet-retained-owners-breakdown.spec.mjs`에서 실제 소련→현대 세계에 복귀하고
254개국/339개 접촉 및 Worker idle 상태를 확인한 다음,
세 *독립 Chromium 컨텍스트*에서 (1) 접촉부터, (2) edge부터, (3) 국가 준비 상태부터
참조를 역순으로 해제한다. 각 단계마다 Worker별 CDP GC 2회 후 V8 used heap,
동일 Worker의 WASM 선형 메모리와 전체 Chromium PSS를 분리 기록한다.
`contact`/edge 값이 같은 객체를 참조하는 경우에는
첫 번째 참조 해제량을 해당 카테고리의 유일·독점 retained size로 해석하지 않는다.

## 실제 독립 컨텍스트 3개 GC 결과

[실제 Chromium 3개 격리 컨텍스트 #39032118412](https://github.com/kimjeon-il/Pando/actions/runs/39032118412) **모두 성공**(Playwright 1/1, 오류 0, Worker WASM 불변).
지표는 Worker V8 *used heap*에서 **각 필드 참조를 그 순서로 파괴한 직후** GC 2회 뒤 줄어든 값이다.
하위 항목들의 GC 결과는 얽힌 참조와 V8 회수 시점에 따라 변하므로 독점 dominator retained size가 아니다.

| 해제 순서 | 최초 JS MiB | 마지막 메시지 | contacts | contactsByOwner | edges | 상위 인덱스 | preparedById | 최종 JS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| contacts → edges → index → byId | 130.26 | 0.02 | 0.29 | 0.02 | **42.11** | 3.22 | **83.35** | 1.25 |
| edges → contacts → byId → index | 133.41 | 0.02 | **33.02** | 0.02 | 12.52 | **86.56** | 0.01 | 1.25 |
| index → byId → edges → contacts | 130.26 | 0.01 | **37.23** | 0.02 | 12.53 | 3.21 | **76.00** | 1.25 |

**두 주요 집합의 교차 판정:**
- `contacts` + `edges` 집합의 해제 효과는 앞 두 시나리오에서 약 **42.40~45.54MiB**, 세 번째에서는 49.76MiB다.
- 국가 준비 데이터 `preparedById` + `upperIndex` 집합은 약 **79.21~86.57MiB**. 상위 인덱스는 보유 중인 prepared 값을 참조하므로 앞뒤 순서의 개별 용량은 크게 바뀐다.
- 마지막 메시지 254개 국가 형상은 prepared와 **254/254 같은 geometry 객체를 공유**한다. 마지막 메시지만 해제해도 대부분 살아 있다.
- 마지막 전체 `boundaryState` 참조까지 해제하면 Worker V8은 **1.25MiB** 수준으로 내려가며, 동일 Worker의 WASM 선형 메모리는 변화하지 않는다.

**실제 기여 수의 결정적 관측:** 현대 접촉 **339건**, 공유 edge **68,616개**,
`edges`의 `contributions` 항목도 **68,616개**다. 모든 edge가 현재 기여자 **정확히 1개**만 가진다.
`edges.value`는 기여 `Map`의 segment 값과 같은 객체 **68,616/68,616**이며,
복제·병합된 `value` 객체는 **0건**이다.
현재 `Map` 하나를 각 단일 기여 edge마다 유지하는 비용은 줄일 수 있는 구체적 후보지만,
해제 효과 약 42~50MiB 전체가 그 `Map`의 독립 낭비량인 것은 아니다.

## 최적화 후보와 계약

**우선: 단일 기여 edge의 작은 레코드**로 대체하고 **다중 접촉 충돌이 처음 생길 때만 Map으로 승격**.
접촉 제거 후 다시 단일 기여로 돌아오면 역으로 축소한다. `segments()`의 정렬/객체 identity,
cached seed, replace/patch, 삼중 국경 및 실제 C++ 경계/렌더 패킷은 변하지 않아야 한다.
특히 현재 세계에 충돌 edge가 없다고 해서 해당 일반 경로를 제거하지 않는다.

그다음 조사: 나머지 **약 79~87MiB** 국가별 원본 선분·압축 공간 인덱스/geometry 참조.
이 영역을 모두 삭제하면 패치 후보 조회 및 source-ref 역매칭이 망가질 수 있으므로
형상별 수명/값 참조 보존과 query 비용을 먼저 조사한다.
실제 Chrome heap snapshot의 dominator 그래프는 아직 수집하지 않았고, 이 보고서는 GC 해제 순서 교차 진단이다.
Android 실기기는 현 환경에 없어 검증 범위에서 제외한다.
