# 원격 Viewer 미리보기

현재 브라우저 제품은 Web Viewer다. 브랜치 미리보기는 [Viewer Preview workflow](../../.github/workflows/viewer-preview.yml), 공개 게시는 [Pages workflow](../../.github/workflows/web-pages.yml)가 소유한다. 앱 배포나 native SDK 설치를 브라우저 미리보기의 전제로 두지 않는다.

## Codespaces

기존 [.devcontainer 구성](../../.devcontainer/devcontainer.json)과 [시작 스크립트](../../.devcontainer/start-preview.sh)를 사용한다. 해당 브랜치의 의존성과 고정 자료 pin을 기존 준비 절차로 준비하고 `pnpm dev:web`로 Viewer를 실행한다. PORTS에서 4173 포트를 열며 공개 범위 변경은 사용자가 결정한다.

원격 코드·자료 pin과 실제 확인한 브라우저·renderer를 구분한다. 원격 브라우저 결과가 실제 Windows GPU·WebView나 모바일 장치 검증을 대신하지 않는다. 미리보기를 준비하면서 전체 GIS를 재생성하거나 배포하지 않는다.

## 정적 산출물

압축 해제한 검증된 Viewer 산출물은 [미리보기 서버](../../scripts/p3-preview-server.mjs)로 제공한다. 원본 경로와 공개 URL의 정본은 [frontend layout](../../scripts/lib/frontend-layout.mjs)이며 Worker·WASM도 같은 산출물의 경로를 사용한다. 실행 중인 서버·자료 lease와 사용 중인 산출물은 정리하지 않는다.

검증은 [변경 영향 선택기](../../scripts/plan-application-checks.mjs)로 관련 시나리오만 선택한다. 렌더·프로젝트 전환·파일 입력을 변경한 경우 실제 Viewer 동작을 별도로 확인한다.
