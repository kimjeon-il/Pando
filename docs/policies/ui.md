# UI·상호작용 정책

**현행 제품:** 브라우저 기반 Web Viewer(모바일 포함)와 내장 읽기 전용 점검 UI입니다. Windows·Android 독립 제품, 구형 편집기·추가/편집 마법사는 현행 출시 기능이 아닙니다.

| 책임 | 정본·참고 | 적용 수준 |
| --- | --- | --- |
| 공통 타이포·컨트롤·간격·반응형 | [UI Architecture](../architecture/ui-architecture.md) | 사용 중인 UI 공통 규범 |
| 컴포넌트별 예외 | [UI Components](../architecture/ui-components.md) | 상위 규격을 중복 정의하지 않음 |
| 현재 Viewer 모듈 | [모듈 소유자 목록](../app-module-ownership.md), [Viewer 조립](../../src/app/viewer-composition.js) | 실제 코드 진입·수명주기 |
| 레이어·지도 UI | [레이어 표현 코드](../../src/ui/layer-presentation.js), [공통 토큰](../../src/ui/css/tokens/design-tokens.css) | UI 상태와 렌더 원본 분리 |
| 이전 편집 IA 및 수명주기 | [UI Information Architecture](../architecture/ui-information-architecture.md), [구형 App 경계](../architecture/app-ui-boundaries.md) | 당시 UX·검증 이력으로 보관; 현재 기능 요구가 아님 |

**검증 계약:** `check-group:ui-architecture`, `check-group:ui-components`, `check-group:ui-layering`, `check-group:ui-ia`. 현재 일괄 명령은 `check-script:check:ui`. 실제 화면·키보드·반응형의 시각 합격 여부는 해당 브라우저 검사로 확인해야 합니다.
