# P6-3 후속 포렌식 — 패킷 3초 병목과 역방향 full 전송

작성: 2026-11-03 · 대상: P6-3 격리 B `0af8b63d2efbeb19e9b677ec23d5f3fb92abfb83` / 기준 A `ee6efddb7335a6665647cc69951e40103830c3e8` · 브라우저/데이터는 W2-P6-5 원본 핀

## 범위 및 판정

**기존 실GPU 증거 및 소스 정적 분석은 완료.** 기존 CDP 마커는 패킷 전체만 감싸므로 **3초의 하위 함수별 실측 분해는 아직 수행되지 않았으며, 새로운 GPU 측정값을 생성하지 않았다.** 1991→1992에서 B가 10/10 full로 전송한 사실은 확인했으나 그 요청에서 어느 안전 게이트가 full을 선택했는지 기록하지 않았으므로 **정확한 단일 분기 이유는 미확정**. 가장 강한 소스상 후보는 국가 ID의 중간 삽입 또는 기존 ID의 순서 재배열에 따른 append-only order guard다. Worker 인증 상태 부재, 미확인 전송 등이 원인인지 추가 계측해야 한다.

원본 보고서: [W2-P6-5 GTX1650 실GPU](https://github.com/kimjeon-il/PandoLab-library-data/blob/5d245b038eb2009c5a44cf8af6a1d18cd21f4d66/reports/development/performance/w2-p6-5-windows-gpu-2026-11-03/report.md). 분석 입력 `diagnostic-analysis.json`, `history-summary.json`, `w65-history-B-0.json`은 동일 라이브러리 커밋에 보관.

## 1. 1992-12→1991-12 요청 #9, CDP 단일 진단 표본

| 직렬 경계 (ms) | A | B (delta) | A2 |
| --- | ---: | ---: | ---: |
| 메인 postMessage | 186.879 | 1.570 | 190.161 |
| post 완료→Worker 수신 | 229.424 | 2.616 | 231.729 |
| Worker digest | 106.449 | 9.583 | 109.894 |
| digest 종료→packet 시작 | 636.186 | 636.932 | 635.045 |
| packet 전체 | 2988.229 | 3020.889 | 2973.397 |
| packet 종료→메인 수신 | 111.525 | 136.777 | 110.335 |
| 메인 수신→국경 게시 | 349.812 | 335.521 | 332.948 |

Worker packet 결과의 cacheHit는 false. A/A2는 242개 full 좌표, B는 242개 중 1개만 좌표 포함·241개 생략·4개 삭제 ID다. 델타 전송이 clone/해시 시간에 효과가 있지만 패킷 전체 계산과 그 전 상태 갱신은 거의 동일하다. 각 구간은 **단일 CDP 진단 실행**이며 10회 display p50이 아니다. `postMessage` 이후 대기는 Worker 이벤트 큐/브라우저 복제 처리를 별개로 분리한 값이 아니다. 해당 두 단계의 내부 비용을 단일 함수에 귀속시키지 않는다.

10회 실제 표시 p50: 1992→1991 A 5371.1ms / B 5126.8ms / A2 5354.8ms. 반대 1991→1992 A 5901.6ms / B 5893.4ms / A2 5847.5ms. 1991→1992 B는 246개 좌표 모두 포함한 replace 10/10. 최초 2026→2025 B는 새로운 공유국경 Worker 요청 없음.

## 2. 패킷 계산 구간의 실제 호출 트리와 무효화 계약

`src/rendering/workers/country-shared-boundary-worker.js`의 packet 타이머는 다음 전부를 감싼다.

1. `boundaryState.features()` / `packetIdentity()` : 품질·outline 사용·ID·계층·SHA revision으로 전체 패킷 키 산출.
2. `retainedPacket` cache 검사: 변경 ID가 있거나 외부 캐시를 새로 심으면 보관본 무효화. 실제 1992→1991 요청은 cacheHit=false.
3. cache miss이면 `prepareCountrySharedBoundaryPacket(boundaryState.segments(), preparedFeatures, ...)` 호출.
   - `boundaryGeometryCache`는 preparedStore별로 **전체 ID/경계 루트/geometry key 순서**를 결합해 검사. 국가 삭제·신규 추가는 캐시 키를 바꾸므로 `internal`/기존 `outlines`의 부분 재사용이 불가능.
   - 각 루트에 대한 `buildTerritorialInternalBoundarySegments`, 계층 contact classification(`boundaryOpposingInteriorsBatch`)을 다시 실행.
   - **오직 `includeOutlines === true`일 때** 선분 spatial index 작성, 각 국가 원본 변 탐색, overlap candidate 조회 및 `boundarySubtractOverlapsBatch`의 청크 호출, outline cache 재작성. 해당 1991년 실측 조건에서 실행 여부 자체가 기존 마커에 기록되지 않았음.
   - `prepareStrokePacket(visible,...)`과 `prepareStrokePacket(outlines 또는 빈 배열,...)` 호출. 각 함수는 owner key별 정렬, JS source 배열 생성, **C++ WASM `boundaryAssembleStrokePacket`**, JS `buildGpuStrokeInstances`를 수행.
4. 패킷 용량 상한(96MiB) 판단 후 `copyTransferredArrays(packet)`로 보유할 6개 TypedArray 복제.

`src/geometry/native/bindings/boundary-bindings.cpp`의 `assembleSharedStrokeForWeb`는 JS `val` 입력을 읽고 native stroke assembler를 실행한 뒤, 매 세그먼트 객체·owner 배열을 `emscripten::val`로 구성하고 Float32Array를 만든다. 이전 W2-P2 분석에서 WASM↔JS 핸들 변환 프로파일 신호가 확인됐으나, **이번 약 3초 중 native 조립/JS marshalling/buildGpuStrokeInstances 각각의 시간은 미계측**이다. 과거 별도 샘플의 ~1초 또는 Linux CI 복사 시간 수치를 이 측정의 내부 비율로 대입하지 않는다.

패킷 타이머 *밖*의 636ms는 `boundaryState.replace` → `preparedStore.replace` → 변경한 국가와 공간적으로 인접한 국가의 contact `reconcile`, `computeCountrySharedContacts`, 적용 후 최신 요청 확인 및 yield 등을 포함한다. 이를 GPU 실행시간 또는 단순 setTimeout 대기로 단정하지 않는다.

## 3. 역방향 full 경로 조사

`country-boundary-geometry-transport.js`의 `planReplace()`은 기존 Worker에서 ACK 받은 `accepted` base가 있고 `pending`이 없으며 모든 ID가 고유할 때만 델타 후보를 본다. 그 뒤 다음 순서를 강제한다.

```js
const expectedOrder = [
  ...accepted.order.filter(id => nextIds.has(id)),
  ...order.filter(id => !accepted.byId.has(id)),
];
const orderCompatible = expectedOrder.length === order.length
  && expectedOrder.every((id, index) => id === order[index]);
```

즉 **삭제 + 마지막에 신규 국가 추가**는 허용하되, 새 국가 4개가 기존 242개 사이에 끼어들거나 기존 ID 순서가 바뀌면 안전하게 `replace`로 fallback한다. `builtin-session.js`의 boundaryCollection은 엔티티 목록의 root 순서와 하위 general 엔티티를 **별도로 끝에 추가**한 순서이며 전체 boundaryCollection을 다시 정렬하지 않는다. `territorial-scope.js`와 repository는 원래 document projection 순서를 보존한다. 연도 이동에서 배열 중앙 삽입은 충분히 가능한 경로다.

안전 게이트 이후에도 적어도 한 geometry의 검증된 **동일 객체 주소+GeometryVersionStore reference+geometryRevisionKey**가 일치해야 delta를 발행한다. 어느 것도 성립하지 않으면 full이다. 현재 `history-summary.json`은 메시지 유형/좌표 수만 기록하며 `accepted`, `pending`, ID 배열, `expectedOrder`, 개별 geometry 동일성 및 실제 fallback reason을 기록하지 않는다. 따라서 **중간 삽입이 확정 원인이라고 서술하지 않는다**. 반대 방향에서 241개 좌표 재사용이 성공한 것은 인증과 객체 동일성이 적어도 한 방향에서 동작한다는 증거일 뿐, 1991→1992 당시의 게이트 상태를 직접 증명하지 않는다.

## 4. 필요한 추가 검증 — 제품 코드는 변경하지 않는 test-only 진단

- 델타 결정 시 (전송 JSON/좌표 없이) `acceptedBasePresent`, `pendingMode`, `validOrder`, `orderCompatible`, 신규/삭제 ID 및 **앞선 공통 ID 순서의 첫 불일치 인덱스**, `certifiedReuseCount`, 선택된 `type`과 fallback reason을 requestId/generation과 기록. 1991→1992와 1992→1991 각각 10회 확인.
- Worker에서 `state.replace` 시작·종료, `reconcile` / shared-contact native 호출, yield 예약/재개, `boundaryGeometryCache` hit, `includeOutlines`, 입력 선분 수를 mark로 기록.
- packet 내부에 `internal-build`, `hierarchy-classification`, `outline-index`, `outline-query`, `outline-overlap-wasm`, `stroke-source-sort`, **두 번의** `boundaryAssembleStrokePacket` 호출, **두 번의** `buildGpuStrokeInstances` 호출, `retained-copy`를 개별 span으로 주입. C++ 본체와 JS↔WASM marshalling을 구별할 수 없다면 합산 bridge span으로 표현하고 필요할 때 프로파일 표본을 추가.
- CPU profile 부하가 없는 공통 시계(CDP trace) 단계 표본을 우선 확보; 별도 V8 CPU profile은 식별 검증 전용으로 분리. A→B→A2, 동일 source/data/build/GPU 설정, history 날짜쌍 각 조건 ≥10회. 완전한 상태·국경/관계/라벨 해시, 취소/오류 주입과 기존 worker 인증 게이트를 유지. 타이밍의 내포 관계와 관측 부하를 원시 기록에 보존.
- 통제용 단위 fixture `[A,B]→[A,X,B]`(middle insert)는 기존 helper에서 **replace**가 나와야 하며 `[A,B]→[A,B,X]`(append) 및 삭제는 인증된 형상에 한해 **delta**가 나와야 한다. Worker의 Map order와 fresh full packet ownerRanges/TypedArray 동등성 확인 없이는 순서 게이트를 무작정 제거하지 말 것.

## 5. 권장 최적화 우선순위

**(1) 패킷 단계 정밀 프로파일 → (2) 전체 ID 키 때문에 재수행되는 outline/경계 파생물의 부분·의존성 캐싱 가능성 평가 → (3) WASM↔JS stroke packet 객체 마샬링 및 JS stroke 인스턴스 생성 최적화 검토 → (4) 역방향 order-compatible delta의 안전한 확대.**

순서 게이트만 완화하면 1991→1992의 약 0.2초 수준 postMessage 비용 개선 가능성이 있지만, 실제 변경 연도 packet miss의 약 3초 계산은 그대로 남을 수 있다. 반대로 packet을 무조건 재사용하면 변경 국경·국가 관계에 대한 정합성을 깨뜨린다. 검증 전 제품 통합/채택, `main` 병합 및 배포는 보류한다.

참조 소스: `src/rendering/country-boundary-geometry-transport.js`, `src/rendering/country-shared-boundary-packet.js`, `src/rendering/workers/country-shared-boundary-worker.js`, `src/document/builtin-session.js`, `src/geometry/native/bindings/boundary-bindings.cpp` — P6-3 B 고정 SHA `0af8b63d2efbeb19e9b677ec23d5f3fb92abfb83`. 이 문서는 분석 전용이며 제품 파일을 수정하지 않는다.
