# P4–P6 렌더링 공통 책임 정상화 (2026-11-09)

대상 브랜치: `work/check-tool-cleanup-20261109`. 기준: P0–P3 `3daed611`. 작업의 범위는 코드 소유권과 동일 계산 경로 통합이며, 문서 정본·지오메트리·GPU 자원 포맷·외부 GIS 라이브러리 핀은 변경하지 않는다.

## P4 — 위치·소유권 정리
- `src/rendering/workers/gpkg-read-core.js` → `src/data/workers/gpkg-read-core.js`.
- `src/rendering/workers/worker-rpc-host.js` → `src/runtime/workers/worker-rpc-host.js`.
- 프로젝트 파일/지명/문서 세션/지도 Worker의 소스 import와 RPC 단위 검사 경로를 수정한다.
- 게시 URL은 각각 `assets/js/workers/gpkg-read-core.js`, `assets/js/workers/worker-rpc-host.js`로 유지한다. 파일 내용 자체는 이동 전후 동일하다.
- 커밋: `de85b980`.

## P5 — 날짜·게시 상태 분리
- `src/rendering/map-presentation-session.js`가 시점 변경 티켓, 메시 content identity, source admission, 프로젝트 세대별 지도 게시 대기, 승인 프레임 commit, 취소/교체/폐기 수명을 전담한다.
- `gpu-map-renderer.js`는 단일 RenderDevice/WebGL context, C++/WASM 메시·DEM·하천 준비, 복구 프레임 증거, 실제 GPU/Canvas 게시 자원에 대한 책임을 유지한다.
- GPU 상태에 결부된 `temporalFrameReady`는 원래 렌더러의 소유로 보존한다. 세션은 callback으로 해당 소유자의 판정·무효화·오류 반응을 소비할 뿐 두 번째 Renderer 또는 두 번째 문서 상태를 만들지 않는다.
- `gpu-map-renderer.js`: 6,229 → 6,145줄.
- 커밋: `5316b0f`, GPU별 준비 게이트 누락 복구 `61a0c80`.

## P6 — Canvas/terrain 중복 로직 정리
- 기존 공유 `terrain-tile-selection-core.js`에 `chooseLevel`, `createVisibilityCache`를 추가해 WebGL과 classic Canvas Worker의 가시 타일 선택·키별 캐시 갱신·LOD 비교 규칙을 하나로 통합한다. 캐시 객체는 backend별로 별도 생성하므로 컨텍스트/프로젝트 수명을 공유하지 않는다.
- GPU 캐시 초기화 경로도 새 팩터리의 `clear()`를 호출하도록 변경한다.
- `canvas-visual-frame-queue.js`가 `rendering-domain.js`의 보류 프레임 등록, 이전 revision 폐기, Worker bitmap 결과 매칭, 수락 후 정리를 단일하게 관리한다. 이는 실제 Worker message queue를 대체하는 것이 아니다.
- 기존 초기 지도 게시·지형 선택적 준비·WebGL1/2/Canvas fallback 로직을 변경하지 않는다.
- 커밋: `75eaa961`, `92d653da`.

## 검증 근거와 차단 요인
- GitHub 원격 트리에서 옛 두 소스 위치가 제거되고 새 소유 위치가 등록되었음을 확인했다.
- 새 순수 세션·Canvas 프레임 큐·공통 가시 캐시의 독립 실행 22개 조건을 확인했다. 관련 수정 모듈의 정적 자바스크립트 구문 파싱도 확인했다. 이는 Node/Playwright/GPU/WebAssembly 실행 검증의 대체물이 아니다.
- `main` 변경 없음. `viewer-preview.yml`의 `plan` 작업은 **P0–P3 이전 커밋에서도** `assets/data/world/build-input.json` 파일 미존재로 실패했다. 현재 브랜치의 Viewer CI 또한 동일 단계에서 중단되어 P4–P6 본문을 아직 실행하지 못했다.
- 외부 라이브러리 준비와 P2 아티팩트 그래프의 실제 입력 소유 경로를 먼저 정상화한 뒤, Worker 자산 게시·GPKG 읽기·날짜 복귀·Canvas/WebGL 전환·Context loss·LOD 픽셀 결과 및 성능을 실 CI에서 검증해야 한다.
