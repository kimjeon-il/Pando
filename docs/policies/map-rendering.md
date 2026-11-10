# 지도 표시·LOD 규칙

**유효 범위:** 지도 표현, 표시 파생 형상, 라벨 정렬 및 자원 수명. 지리 원본·프로젝트의 편집 형상은 렌더러가 소유하지 않습니다.

| 책임 | 문서 또는 코드 정본 | 비고 |
| --- | --- | --- |
| 화면 시각 순서·선분 스타일 | [M4–M7 시각 정책·검증 기록](../architecture/map-visual-policy.md), [레이어 표현 코드](../../src/ui/layer-presentation.js) | 문서의 당시 M4–M7 검증 로그는 현재 성공 판정이 아님 |
| 기기·프레임 품질 | [적응형 품질 규칙](../architecture/adaptive-render-quality.md) | GPU/CPU 예산과 기하 정확도 구분 |
| 동적 벡터 LOD | [P0/P1 설계·실행 기록](../architecture/map-rendering-lod-p0-p1.md), [LOD 구현](../../src/rendering/render-lod.js) | 검사와 소스 정본 보존; 미완료 당시 기록을 현행 상태로 소급하지 않음 |
| 프로젝트별 확대·LOD 전환 | [프로젝트 공통 LOD 작업 계획](../architecture/project-common-lod-implementation.md), [메시 선택 코드](../../src/rendering/country-mesh-zoom-policy.js) | 2026-11-10 계획 당시 승인 범위를 현재 상시 명령으로 취급하지 않음 |
| 지도 라벨 겹침·표시 | [라벨 레이아웃](../../src/rendering/label-layout.js), [영토/지명 라벨](../../src/rendering/territorial-labels.js) | 지명 선정 자체는 [지명 정책](places.md) |
| 자원 무효화·재사용 | [런타임 자원 정책](../../src/runtime/resource-dependency-policy.js) | [AGENTS.md](../../AGENTS.md)의 지도 자원 원칙과 연결 |

**검증 계약:** `check-group:renderer-contract`, `check-group:gis-contracts`, `check-group:rendering`. 표시 코드의 실제 품질/픽셀 동등성은 해당 브라우저·GPU 검증을 별도 수행해야 합니다.
