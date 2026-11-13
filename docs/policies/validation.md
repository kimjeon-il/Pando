# 검증·CI 계약

현행 검사 정본은 [등록 계약](../../scripts/contracts/application-checks.json), [영향 선택기](../../scripts/plan-application-checks.mjs), [실행기](../../scripts/run-application-checks.mjs)다. 전체 검증은 사용자가 그 범위를 명시적으로 요청했을 때만 실행한다. 변경에 직접 필요한 검사와 준비·증분 빌드를 선택하고 실제 결과를 확인한다.

정책 링크는 [정책 검사](../../scripts/check-policy-links.mjs), workflow 분류는 [실행 분류 정본](../../scripts/contracts/workflow-inventory.json)이 소유한다. 완료된 일회성 job과 측정 출력은 현행 통과 근거로 사용하지 않는다.

**검증 계약:** `check-group:policy-links`, `check-group:workflow-ownership`, `check-group:runtime-boundaries`, `check-script:check:policies`.

## 성능 측정·승인 원칙

- 측정에는 코드 커밋·자료 pin·장비·운영체제·브라우저·화면 크기·시나리오를 기록하고 같은 조건끼리 비교한다. 과거 측정값을 현재 main의 성능이나 합격 기준으로 사용하지 않는다.
- Worker JS heap, WASM 선형 메모리, 프로세스 PSS, 애플리케이션 추적 GPU 자원은 서로 다른 측정값이다. 선형 메모리 크기를 실제 C++ 사용량으로, 추적 자원을 전체 GPU VRAM으로 표현하지 않는다.
- 미측정·지원하지 않는 항목은 null로 남기며 0이나 성공으로 대체하지 않는다. GC 이후 안정 구간·첫 진입·반복 전환·최종 idle은 구분해 기록한다.
- CI 샘플만으로 성능 예산을 승인하지 않는다. 실제 대상 환경의 측정과 사용자 승인 전에는 숫자 임계값을 합격 기준으로 적용하지 않는다. 승인되지 않은 빈 예산 파일은 만들지 않는다.
- 실제 검사 등록은 `scripts/contracts/application-checks.json`만 소유한다. 완료된 성능 작업의 별도 검사 목록과 조립기를 현행 설정으로 유지하지 않는다.


## 현행 검사 책임 경계

- **Render scene / presentation**: frame identity, current-request admission,
  visual order, stage/commit and first-frame readiness. A ready country frame
  must never depend on optional DEM completion.
- **WebGL and mesh resources**: draw preparation and upload are distinct from
  actual draw; LOD/byte budgets, GL context ownership, shader lifecycle,
  SDF joins/caps, selection/picking and resource cancellation stay observable.
- **Canvas**: asynchronous bitmap acceptance, synchronous Canvas2D fallback,
  geographic projection and terrain display remain separate backend contracts.
- **Workers**: RPC cancellation, worker-thread transfer, revision supersession
  and immutable worker-asset packaging remain separate kinds of evidence.
- **Runtime DEM**: manifest admission, LOD selection, visible uploads,
  terrain frame publication, source-limited readiness and raster fallback.
- **Generated DEM**: native/GDAL/Python pixel parity, source pins, output
  hashes, polar/date-line gutters and safe destination paths are never
  replaced by a synthetic browser-only fixture.
- **Performance**: unit policy (DPR, hysteresis, scheduling) is distinct from
  controlled browser performance measurements and their provenance.

현재 모델 팩토리와 서비스로 observable behavior를 검증한다. 폐기된 앱·스키마의 비교 구현은 작은 현행 fixture로 교체하되 오류·원자성·취소·Undo/Redo·geometry 결과 검사는 유지한다. 서로 다른 native/GDAL/Core 전제 조건은 관련 없는 단일 검사에 합치지 않는다.

## 파일·GIS·검사 인프라 경계

- 프로젝트 변경과 rollback·dirty·history는 실제 Core ACK로 확인한다. 잘못된 파일·schema 입력은 현재 프로젝트를 바꾸지 않아야 하며, 저장 중 새 편집을 이전 저장 완료가 clean으로 만들면 안 된다.
- GPKG 검사는 실제 SQL/WASM 파일 바이트·오류 코드·같은 epoch의 공간 결과를 확인한다. metadata-only fixture가 파일 인코딩 검사를 대신하지 않는다.
- GIS 자료 정확성·부모·기간·위상, source admission과 화면 표현은 별도 책임으로 검증한다. native/GDAL·원자료 검사를 합성 브라우저 fixture로 대체하지 않는다. 실자료는 변경한 객체와 필요한 연결 입력만 선택한다.
- 검사 선택기·runner는 전제 조건을 상속하고 실제 공유 자원만 격리한다. skipped·blocked는 passed가 아니다. fixture는 불변 입력·현재 팩토리를 공유하고 전역 가변 상태나 별도 모델 구현을 공유하지 않는다.
- 라이브러리의 잠금·원본·Git 객체 보존·HTTP 인증·부분 push·retry·원격 바이트 확인은 실제 운영 경계로 검사하며 다른 저장소 게시와 app main 통합을 단위검사의 부수 효과로 실행하지 않는다.
