# P0–P3 검사·도구 정리 (2026-11-09)

기준: `main@c9ca35d32c54b1c31bef474683946baa2dc12566`. Viewer 소스·WASM·GIS 원본·외부 라이브러리 자료는 변경하지 않는다.

## P0 검사 입력 복구
- ESLint의 제거된 `shared/frontend/js`, `apps/viewer/js` 기본 경로를 현재 `src/` 도메인으로 교체한다.
- 변경 영향 검사 `lint` 입력에 `src/**`와 하위 도구를 포함한다.
- `native-core` 변경 감지 입력을 현재 `src/**/native/**`, `tools/build/native/**`에 맞춘다. 외부 네이티브 CI 자체는 유지한다.

## P1 검사 카탈로그 축소
- 테스트 매칭 결과가 0건인 `boundaries`, `objects`, `projects`, `ui` 그룹 4개를 제거한다. 관련 소스는 기존 `units`와 실제 브라우저 그룹에서 검사한다.
- 중복 입력 패턴 32건 및 현재 소스에 없는 이전 Viewer 디렉터리 패턴 14건을 정리한다.
- 자동/수동 테스트 본문과 현재 실행 진입점은 삭제하지 않는다.

## P2 완료된 W2 개별 계측 스크립트 퇴역
- `tools/w2-*.mjs` 62개를 현재 개발 도구 트리에서 퇴역한다. 기본 npm 명령 및 현행 77개 CI 워크플로의 직접 실행 대상이 아니며, 과거 Windows GPU 측정/주입/분석을 위해 생성된 일회성 스크립트들이다.
- 4개 스크립트는 이미 삭제된 `tests/browser/helpers/soviet-memory-attribution.mjs`를 import한다. 일부는 과거 Windows 절대경로, 고정 커밋, 소스 텍스트 앵커에 의존한다.
- 원본 스크립트는 Git 이력에 남으며 측정 보고서·원시 증거·현행 성능 수용 테스트는 유지한다. 역사적 측정을 동일하게 재현해야 한다면 해당 커밋과 도구·원본 자료를 별도로 복원해야 한다.
- `tools/benchmark-shared-border-p5.mjs`, `tools/p5-6-*.mjs`는 현행 CI 소비자가 있어 유지한다.

## P3 GIS 도구 분류
- `tools/gis/`의 187개 파일은 현행 하천/DEM/국경 생성·역사 조사 CI와 연결되어 있으므로 이번 정리에서 일괄 삭제하지 않는다.
- `tools/build/`, `tools/data/`, `tools/cpp/`, `tools/checks/`도 빌드·자료 검증 소유자로 유지한다.
- 과거 GIS 일회성 도구는 워크플로 호출·import·원본 증거 소비를 함께 검증한 뒤 별도 삭제할 것. 단순 파일명이나 미등록 npm 스크립트만으로는 미사용을 확정할 수 없다.

## 검증 상태
이 변경은 소스·등록표 정리다. GitHub 원격 작업 환경에서 전체 Node/브라우저/네이티브 CI를 실행하지 않았으므로 테스트 통과 또는 배포 성공을 주장하지 않는다. `main`에는 병합하지 않는다.
