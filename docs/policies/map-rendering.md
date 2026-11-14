# 지도 표시·LOD 규칙

**유효 범위:** 지도 표현, 표시 파생 형상, 라벨 정렬 및 자원 수명. 지리 원본·프로젝트의 편집 형상은 렌더러가 소유하지 않습니다.

| 책임 | 문서 또는 코드 정본 | 비고 |
| --- | --- | --- |
| 화면 시각 순서·선분 스타일 | [M4–M7 시각 정책·검증 기록](../architecture/map-visual-policy.md), [레이어 표현 코드](../../src/ui/layer-presentation.js) | 문서의 당시 M4–M7 검증 로그는 현재 성공 판정이 아님 |
| 기기·프레임 품질 | [적응형 품질 규칙](../architecture/adaptive-render-quality.md) | GPU/CPU 예산과 기하 정확도 구분 |
| 동적 벡터 LOD | [P0/P1 설계·실행 기록](../architecture/map-rendering-lod-p0-p1.md), [LOD 구현](../../src/rendering/render-lod.js) | 검사와 소스 정본 보존; 미완료 당시 기록을 현행 상태로 소급하지 않음 |
| 프로젝트별 확대·LOD 전환 | 현행 계약, [메시 선택 코드](../../src/rendering/country-mesh-zoom-policy.js) | 2026-11-10 계획 당시 승인 범위를 현재 상시 명령으로 취급하지 않음 |
| 지도 라벨 겹침·표시 | [라벨 레이아웃](../../src/rendering/label-layout.js), [영토/지명 라벨](../../src/rendering/territorial-labels.js) | 지명 선정 자체는 [지명 정책](places.md) |
| 자원 무효화·재사용 | [런타임 자원 정책](../../src/runtime/resource-dependency-policy.js) | [AGENTS.md](../../AGENTS.md)의 지도 자원 원칙과 연결 |


## 추가로 확인된 표시 규칙·검증 기록

- [Renderer v2의 단일 렌더러·지오메트리 불변 계약](../architecture/renderer-v2.md): 정본 형상을 표시용 LOD로 역기록하지 않고, Worker RPC·RenderScene·WebGL/Canvas 책임을 분리합니다.
- [상호작용 강조의 우선순위와 검증](../interaction-emphasis.md): 선택/호버/편집 시 시각 우선순위가 기술되지만, 당시의 편집 기능·브라우저 검증이 현재 Viewer에서 그대로 유효함을 뜻하지 않습니다.
- [DEM 지형 정책·전환 기록](../terrain-dem.md): 지형 자료는 프로젝트별 `dem-relief-v1` 계약을 따르며 과거 raster fallback 서술은 당시 구현·검증으로 구분합니다.
- [성능 진단 지표](../performance-diagnostics.md): 통계적 계측 기준과 실제 기능 차단 상한을 혼동하지 않습니다.

