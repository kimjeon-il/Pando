# W2-P6-3 국가 형상 Worker base+delta 전송 — 격리 구현 및 검증 결과

작성: 2026-11-03
대상: `kimjeon-il/Pando`의 격리 브랜치 `work/w2-p6-3-geometry-delta-20261103`
기준: `work/ui`에서 분기. **main 병합·배포·GIS 데이터·Core/WASM 변경 없음.**
상태: **P6-3 기능 구현 및 Linux CI 기능 회귀 통과. 성능 채택·Windows GTX 1650 실GPU 검증은 별도 게이트로 유보.**

## 구현 계약

- `country-boundary-geometry-transport.js`: 메인은 처음에는 전량 `replace`, 확인된 Worker `baseToken`이 있을 때만 `delta`를 생성한다. 델타는 현재 전체 국가 ID/메타데이터, 변경·검증 불가 형상, 삭제 ID를 포함한다. 기존 검증된 좌표를 생략해도 국명·상하 소유관계 등 메타데이터는 유지한다.
- 메인에서 좌표 생략은 **동일한 불변 `GeometryVersionStore` 객체**, 동일 `geometryReferenceFor` ID/버전, 동일 `geometryRevisionKey`, Worker 완료 확인이 모두 충족될 때에만 허용한다. 일반 WeakMap 객체 키, mutable revision 또는 새로운 프로젝트 세대만으로는 좌표 동일성을 인정하지 않는다. 새 객체에 복제된 동일 좌표라도 보수적으로 전송한다. UI 스레드에서 13MB 전체에 대한 별도 JSON 직렬화·깊은 복제·SHA-256을 추가하지 않는다.
- `country-shared-boundary-worker.js`: 처음 받은 전체 좌표는 종전처럼 Worker 내부 SHA-256으로 검증한다. 마지막으로 정상 `prepared` 응답을 전송한 Worker의 검증된 geometry/digest만 다음 델타 기초로 인증한다. 좌표가 포함된 변경 형상은 Worker에서 새로 해시하고, 생략한 형상은 이전에 검증된 좌표와 digest를 사용한다. Worker는 중복·누락 ID, 삭제·잔존 집합 및 토큰 불일치를 `resync`로 거절한다. ID 재정렬·중간 삽입은 sender가 순서 호환성을 확인해 full `replace`로 전송한다.
- `gpu-map-renderer.js`: 종전 `requestId`, `projectGeneration`, `geometryRevision`, `quality`로 현재 응답인지 먼저 확인한다. `resync`를 받으면 현재 권위 있는 전체 입력으로 재시도한다. Worker terminate, 오류, patch 경로에서는 전송 기초를 초기화한다. 동시에 수행 중인 요청을 임의로 안전한 base로 간주하지 않는다. 종전 `preparedStore`, `retainedPacket`, 96MiB 보존 상한, temporalFrameReady 및 이미 표시한 지도 유지 동작은 보존한다.

## 검증 실적

1. 1차 격리 CI [41553421726](https://github.com/kimjeon-il/Pando/actions/runs/41553421726) **성공**: Node 구문 검사·ESLint, 전송 helper 단위 테스트, 실제 Node Worker 기하/국경 packet 동등성 테스트, 실제 Viewer 연도 전환·Worker packet 재사용 브라우저 회귀, Worker 오류 주입·Core rollback/픽셀·재전환 회귀.
2. 2차 격리 CI [41553889273](https://github.com/kimjeon-il/Pando/actions/runs/41553889273) **성공**: 모든 동일 테스트에 더해 브라우저 Worker 전송 payload를 관측하고, 기초 토큰이 있는 상태에서 실제 강제 경계 재준비 시 국가 `254`개 중 `254`개의 `geometry`가 생략됨을 검증.
3. 실제 Viewer 로그: `W2_P6_3_REAL_VIEWER_TRANSPORT` — 먼저 `replace` 요청의 총 `254`개 형상 중 `254`개 `geometry` 전송; 이후 강제 재준비 `delta` 요청은 `total:254, included:0, omitted:254, removed:0, hasBaseToken:true, deltaCount:1, reusedGeometry:254`. 이는 **동일 형상 강제 재준비에서의 좌표 전송 생략** 증거이며, 전체 메시지 0바이트나 일반 날짜 변경의 전송량 평균을 뜻하지 않는다.
4. Node Worker 검증 시나리오: 부모/자식 소유권 재배치, 이름만 변경, 1e-8도 실제 좌표 변경, 삭제, `includeOutlines` 변경, 원본 fresh full과 packet 구조·TypedArray·ownerRanges의 정확한 일치, 잘못된 토큰/삭제 집합/신규 미포함 geometry 거부, Worker 재시작 후 full 복구, 미확인 요청 재사용 거부.

## 제한과 미완료

- 이번 GitHub Actions는 Linux Chromium의 **기능 정확성 테스트**다. 기존 W2-P6에서 요구한 **Windows GTX 1650 / D3D11 / Chromium 151.0.7922.34**의 독립 A-B-A 성능 검증은 **실시하지 않았다**.
- 첫 전체 형상 로딩은 여전히 full 전송한다. 현재 브라우저 로그는 같은 형상에 대한 **강제 Worker 재준비** 1회이며, 실제로 국경과 상하관계가 바뀌는 여러 연도의 일반 전환에서 바이트·p50/p90 개선을 뜻하지 않는다. 시간 측정/메모리·GC·WebGL context loss·stale 응답 복합 스트레스 및 Windows 오류 후 롤백 픽셀 재확인은 별도 과제다.
- `geometryReferenceFor`로 증명되지 않은 동일 내용 또는 형상 재할당은 full 값 전송을 유지한다. 이는 안전성을 위한 보수적 fallback이며, 높은 재사용률을 임의 가정하지 않는다.
- 따라서 **제품 브랜치 `work/ui` 적용·`main` 병합·웹 배포는 수행하지 않았다.**

## 다음 게이트

P6-5의 동일 데이터/소스 조건 A→B→A2: 실제 날짜 전환과 변경 국가 포함, cold/normal/forced Worker 요청 분리, 표시 승인 지연과 p50/p90/max, 장기 꼬리, structured-clone·Worker digest/queue·GPU 업로드, 메모리/GC·입력 반응성, 60회 이상 stress, 빠른 연속 취소/rollback/Canvas/WebGL 복구를 측정한다. 채택은 실제 사용자가 보는 `onPresented` 시간과 정확성에서 유의미한 개선이 입증될 때만 결정한다.
