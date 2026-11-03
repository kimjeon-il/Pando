# R4-E4/E5 — 구형 편집기 소스 철수 완료 및 최종 수용 검사

검증일: 2026-11-03. 대상: `kimjeon-il/Pando`의 비상설 `integration/r4-gis-w2-20261103` 브랜치.
정본 수용 검사 대상 소스: `3e9a9949d384898fc0aab4ee846718ca31830997`.
기준 `main`: `c6b91ee1f8b09808f71a1d021bcb9db2c5ef2f7b`.

## 완료 판정

**R4-E4/E5 완료조건 충족.** 구형 편집기 UI, 편집 서비스, Worker 전체 153개 기준 소스를 철수했고, Viewer·실제 Windows 2022 Tauri/WebView2 읽기 전용 검수기의 회귀 테스트가 모두 통과했다. 코드/데이터 정본은 `apps/viewer`, `shared` Core/WASM, `tools/gis`, `tests/helpers`, Windows `apps/editor/src-tauri`에 유지된다. 공개 웹용 자료 pin과 별도 자료 저장소는 변경하지 않았다.

### 정확한 철수 범위

- 구형 `apps/editor/frontend/` 및 `apps/editor/templates/` 소스: **153 / 153 삭제, 잔여 0**. R4-E4 첫 배치 29개를 포함해 이번 작업에서 마지막 74개 제거.
- 구형 테스트: 누적 **260개 철수** (`r4-source-pruning.json`의 `removedTests` 정확한 목록). 그중 마지막 74개는 구형 편집기 기능에 직접 의존하던 테스트.
- 정본 Core 드래프트의 23단계 작업·이전 문서 epoch·늦은 드래프트 결과 거부는 `tests/unit/core-document-draft-wasm.test.mjs`에서 **구형 편집기 facade 없이** 검사하며 `core-draft-primitives`, `web-draft-contract`, GIS·GeoPackage 테스트와 Viewer/Windows E7 수용 테스트를 보존했다.
- 이전 편집기의 모듈을 참조하던 정적 테스트, 정책 및 기본 테스트 등록부에서 폐기된 경로를 분리하고 현재 Viewer/공통 Core 위치로 옮겼다. R4-E0 기록은 과거 소스의 103개 분류를 역사 증거로 유지한다.

### 검증 증거 — 코드 SHA `3e9a994`

| 검사 | 결과 | 증거 |
| --- | --- | --- |
| R4-E4/E5 source snapshot 및 의존성 감사 | **PASS** | [Actions 41624022591](https://github.com/kimjeon-il/Pando/actions/runs/41624022591) |
| R4-E0 audit | **PASS** | present=0; directActiveReferences=0; internalEdges=0; cycles=0; errors=[] |
| Application Architecture | **PASS** | [Actions 41624022844](https://github.com/kimjeon-il/Pando/actions/runs/41624022844) |
| E7 C++ Core/read-only acceptance | **PASS** | [Actions 41624022575](https://github.com/kimjeon-il/Pando/actions/runs/41624022575) |
| E7 Chromium WebGL/Canvas/mobile | **PASS** | same run, independent browser Job |
| E7 Windows 2022 actual Tauri/WebView2 reviewer | **PASS** | same run, independent Windows Job |
| P3 remote preview/Web | **PASS** | [Actions 41624022816](https://github.com/kimjeon-il/Pando/actions/runs/41624022816) |
| Stage 2 boundary Worker/history regression | **PASS** | [Actions 41624022792](https://github.com/kimjeon-il/Pando/actions/runs/41624022792) |
| Python/GIS source and pinned data contract | **PASS** | [Actions 41624022686](https://github.com/kimjeon-il/Pando/actions/runs/41624022686) |

GitHub Actions의 Job 성공은 Linux 또는 Windows CI 실행 환경에서의 결과이며, 사용자 PC에서 수동으로 실제 설치 파일을 실행해 승인했다는 뜻은 아니다. 이 수용 검사는 새 Windows 설치 파일을 공개 배포하지 않는다. 외부 대용량 GIS 원본의 완전 재생성이나 GTX1650 장기 성능 재평가까지 이번 완료조건에 포함하지 않았다.

## 병합·배포 상태

이번 E4/E5 코드는 **비상설 통합 브랜치에만 반영**했으며 `main` 병합·GitHub Pages 재배포는 수행하지 않았다. 완료 판정은 최종 소스 SHA의 실제 CI 검증을 의미하며 메인 게시물의 반영 여부와 구분한다. 이 보고서 갱신은 검증된 소스를 수정하지 않는 문서 전용 커밋이다.
