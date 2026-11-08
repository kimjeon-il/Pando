# 지도 렌더링 최적화: 상태·자원 소유권 경계 (2026-11-08)

범위: `work/optimization`, Web Viewer 지도, WebGL1/2, Canvas Worker/Canvas2D, DEM, Hydro, 렌더링 Worker. 이 문서는 기존 실행 경로를 설명하며 새 렌더 루프나 별도 프로젝트 상태 소유자를 요구하지 않는다.

## 변경하지 않을 실행 계약

1. `map-visual-frame.js`: 하나의 카메라·DPR·투영 스냅샷. UI/Worker/GPU는 해당 프레임을 소비한다.
2. `map-render-coordinator.js`: 무효화 마스크와 프레임 순서의 단일 조정자. `rendering-domain.js`는 화면 계층별 의도만 전달한다.
3. `gpu-map-renderer.js`: GPU Device와 WebGL Context의 유일한 소유자. 폴리곤/스트로크/선택 패스는 공유 Device를 빌려 사용한다.
4. `render-scene.js` / `gpu-scene.js`: 읽기 전용 형상 패킷과 도메인별 변경 판정. 실측 카메라 이동만으로 삼각분할 또는 형상 해시를 다시 계산하지 않는다.
5. `gpu-upload-scheduler.js`: GPU 업로드의 프레임별 예산을 최종 집행한다. 준비 완료만으로 그리기·게시 성공을 인정하지 않는다.
6. `gpu-context-recovery.js`: Context Loss, 취소, 준비, 커밋, Canvas 복구 결과에 대한 세대별 승인과 실패 처리.
7. `gpu-canvas-worker.js` / `canvas-render-worker.js`: 별도의 상태 유지 렌더러이지만 새로운 문서 정본은 소유하지 않는다. 최신 프로젝트/뷰/스타일 리비전이 실제 그려진 bitmap에 부착된다.
8. `gpu-terrain-preparation.js`, Canvas DEM, `gpu-hydro-preparation.js`: 지형·수계 자료, 타일/pack 캐시와 가시 영역 준비 소유자. 선택적 DEM 준비는 첫 국가 지도 게시의 선행 조건이 아니다.

## 책임 분리 기준

- **순수 연산**: 평면 세계 반복 offset, 타일 좌표·인접성·가시 범위, 지도 프레임 게시 키는 재사용 가능하되 원본/기간·프로젝트 키와 무관한 별도 전역 상태를 두지 않는다.
- **실제 GPU 자원**: 생성/삭제/업로드/컨텍스트 상실은 소유 GPU 패스에서 처리한다. 각 패스의 `draw()` 호출은 준비된 리소스를 쓰며 서로 다른 Draw 기능을 임의로 합치지 않는다.
- **Canvas Worker**: classic Worker에서 소비할 수 있는 동일 순수 함수를 공유한다. OffscreenCanvas/이미지 디코드·메시지 전송은 Worker 로컬 소유권으로 남긴다.
- **게시 승인**: 오래된 frameId, 프로젝트 세대·날짜, 물리 기반, 국경·형상 버전과 잘못된 GPU 복구 결과는 게시되지 않는다. 마지막 승인 프레임은 새 결과가 실제로 승인되기 전까지 보존된다.
- **검사**: 실제 GL·Canvas 픽셀 결과, Context Loss, Worker 생명주기, 독립 DEM·Hydro 실원본·네이티브 검증은 유지한다. 원본 검사명 래퍼·소스 텍스트 존재만 확인하는 형식 검사는 참조 정리 후 제거 또는 실행 의미가 있는 경계 검사로 교체한다.

## 단계별 작업 범위

0. 소유권 계약/호출 경계 확정 (이 문서).
1. GPU 렌더러에서 프레임 게시 계산과 백엔드 독립 준비 로직을 분리하되 단일 Device 유지.
2. 공통 offset·타일 계산과 반복 가시성 검색을 통합.
3. 업로드 스케줄러, Polygon Draw 경로, 캐시 변경 판정에서 불필요한 연산 제거.
4. Worker의 동일 타일 수학 및 메시지 생명주기 중복 정리.
5. Context Loss·첫 프레임/날짜 전환 게시의 세대 경계 보존.
6. 확인된 미사용 레거시·무의미한 필드 및 래퍼 제거 (외부 소비자 확인 필요).
7. 테스트 정의와 Fixture·선택기·CI 참조를 삭제·통합·유지로 검토. 전체 실행 검사는 별도 일괄 단계에서 수행.
