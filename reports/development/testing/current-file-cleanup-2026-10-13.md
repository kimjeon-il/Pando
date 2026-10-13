# 통합 저장소 현행 파일 정리 — 2026-10-13

- 기록 ID: `DEV-067`
- 기준 커밋: Web·Native 통합 `Pando/main` `4b891c7886b23b8ded25a0f04b9accc9f9a4b4de`
- 범위: 현행 트리의 **실행되지 않는 중첩 워크플로**만 제거. Git 이력 재작성 없음.
- 산출 브랜치: `cleanup/inactive-native-workflows-20261013`

## 입증된 삭제 대상

| 경로 | 파일 수 | 합계(바이트) | 이유 |
| --- | ---: | ---: | --- |
| `native/.github/workflows/*.yml` | 36 | 132,151 | 앱 저장소 이관 시 보존한 과거 Actions 설정. 통합 GitHub Actions는 최상위 `.github/workflows/`만 실행하며, 필요한 네이티브 검사·연구 작업은 그 위치에 별도 연결되어 있음 |

원본 파일은 삭제 전 Git 커밋 `4b891c7886b23b8ded25a0f04b9accc9f9a4b4de`의 `native/.github/workflows/` 트리와 기존 `kimjeon-il/PandoEditor` 원본 저장소에 그대로 남아 재구성할 수 있다. 개별 파일 내용, 제품 자산·소스, 최상위 자동 검사·배포 workflow는 수정하지 않는다.

## 유지·제외 항목

- 웹 현행 지형 `terrain/v0.12.6`, 최신 수계 `hydro/v0.13.2`, `world/objects`, 영토·지명·기초 GIS 소스 및 `native/assets/world`는 계속 사용·검증되므로 유지한다.
- `reports/`의 기존 조사·검증 보고서, 앱 빌드 입력 `native/reports/places` 및 `tests/`는 유지한다.
- 구버전 `world-preview-v0.31.0` 및 연관 압축 파일은 현재 현역 핀에서 보이지 않지만, 역사적 매니페스트/복원 경로와의 영향 검증이 남아 있어 이번 삭제에서 제외했다.
- `assets/data/countries-preview-v0.30.0.geojson.gz`는 현재 `tests/unit/renderable-outline.test.mjs`에서 읽으므로 반드시 유지한다.
- 삭제된 파일의 대다수는 Git 이력에 남는다. 따라서 GitHub 저장소에 표시되는 전체 용량이 정확히 132,151바이트만큼 감소하리라고 보장하지 않는다.

## 검증 경계

- 변경 전 GitHub 트리에서 제거 대상 36개 및 132,151바이트를 확인하고, 기본 브랜치의 이름을 명시한 코드 검색에서 직접 참조를 발견하지 못했다.
- 통합 `Pando`의 실사용 GitHub Actions 경로는 루트 `.github/workflows/`이며, `native/.github/workflows`의 설정은 이 디렉터리에서는 실행되지 않는다.
- 이전 기준 커밋의 전체 CI에는 공통 코어·CMake·UI 검사 실패가 존재한다. 이 현행 파일 정리를 전체 CI 정상화로 표시해서는 안 된다.
- 최신 원격 CI와 Pages 게시 상태는 작업 후 별도로 확인하여 사용자에게 판정한다.
