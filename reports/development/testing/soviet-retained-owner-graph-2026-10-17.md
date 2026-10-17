# OBJ-091 — 공유 국경선 Worker 잔여 보유 객체 소유권 분해

> 조사일: 2026-10-17 · 상태: `diagnostic-in-progress` · 제품 변경: **없음**
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

## 확정 값과 후속

현재는 구조별 GC 교차 실측을 실행 중이므로 **하위 구조별 절감량은 아직 확정되지 않았다.**
값을 얻으면 접촉, edge 다중 소유 기록, 역참조, 상위 인덱스, 원본 형상·압축 인덱스 순으로
실제 감소량을 기록한다. 값이 확인되기 전에는 특정 구조를 안전하게 지울 수 있다고 판정하지 않는다.

다음 후보는 동일 `edgeKey`에 접촉 하나만 기여하는 경우의 `contributions: Map`
per-edge 할당 제거다. 다중 접촉, 삽입·삭제·기존 C++ 국경 접촉/렌더 출력 동등성을
깨지 않는지 집중 테스트 후, 결과가 클 때만 실제 최적화에 착수한다.
Android 실기기는 현 환경에 없어 검증 범위에서 제외한다.
