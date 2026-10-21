# UI 구조 통일 P4 — 참조 이미지 공통 Surface 통합

> 보고서 ID: `UI-CONVERGENCE-P4-20261021` · 상태: `implemented / focused-browser-verified / staged-app-verified / native-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-21
> 원문 최종 수정: 2026-10-21
> 수정 기준: `work/ui`의 `0ce82bbd53dd610095c16525016e6490595daec7`에서 최신 `main`의 `4f35c345e0707c44e383cca027e119207f93259c`로 fast-forward한 뒤 적용한 P4 변경
> 검증 대상: 위 기준 커밋에 이 보고서와 함께 기록한 P4 소스·생성물·테스트 변경
> 근거: [P0 구조 조사](ui-convergence-p0-audit-2026-10-20.md), [공통 UI 구조](../../../docs/architecture/ui-architecture.md), [브랜치 정책](../../../docs/branch-policy.md)

## 범위와 구현 결과

사용자가 지시한 P4, 즉 참조 이미지 패널의 공통 Surface 통합을 구현했다. 기존 P0–P3 결과를 보존하고, 작업 전 최신 `main`의 22개 커밋을 `work/ui`에 fast-forward했다. 공개 웹은 viewer이고 참조 이미지 편집 도구는 앱 편집기에서 제공하므로, 공개 웹과 앱 편집기 검증을 구분했다.

| 소유자 | 변경 내용 |
| --- | --- |
| `reference-image-ui.js` | 최초 생성부터 `workspace-surface surface-reference ui-sheet`와 고정 header/body/footer를 완성한다. 제목, 접기·닫기, 모바일 핸들, 너비 조절 핸들, 요약·완료·취소 명령 영역을 한 번 만든다. |
| `reference-image-surface.js` | 기존 완성 구조에 이벤트와 Surface 상태를 연결한다. 설치 중 header/body를 만들거나 기존 자식을 다시 감싸고 옮기던 처리를 제거했다. 필수 구조와 workspace가 없으면 명시적으로 실패한다. |
| `reference-image-controller.js` | 생성한 패널을 최종 소유자인 `.workspace`에 직접 한 번 부착한다. 모델·저장·보정 계산은 변경하지 않았다. |
| `reference-image-bootstrap.js` | 설치 후 패널과 launcher를 이동시키던 경로를 제거했다. 기능과 스타일의 첫 사용 시 지연 로딩은 유지했다. |
| `components/surface.css` | 참조 Surface의 공통 배경·경계·여백·제목·footer 표현을 담당한다. 일반 Surface와 동일한 토큰과 외형 소유자를 사용한다. |
| 참조 이미지 전용 CSS | 이미지 목록·보정 도구·도킹·너비 조절·접기·모바일 작업 배치를 유지한다. 공통 패널 외형의 중복 선언과 사용하지 않는 높이 토큰을 제거했다. |
| `reference-image-style-sources.js` | 네 개의 지연 로딩 CSS 목록을 런타임 자산 안의 정본으로 정의했다. loader와 UI 소스 catalog가 공유하며 앱 패키지에서 `scripts/`를 참조하지 않는다. |

고정 구조는 `surface-header` → `surface-body` → `surface-footer`이다. 본문에는 이미지 목록과 편집 영역, footer에는 작업 요약과 완료·취소 및 보조 작업 영역을 둔다. 패널 설치·재설치, 접기·펼치기, 모바일 편집 전환 과정에서 이 구조와 제어 요소의 identity·부모를 유지한다.

데스크톱 오른쪽 도킹과 지도 가용 폭, 키보드·포인터 너비 조절, 접기, 모바일 하단 시트와 작업 중 요약 모드를 보존했다. `gis-form-grid`에 의존하던 본문은 일반 Surface 본문으로 정리하고, 이름·불투명도·회전·보정 방식·혼합 입력을 기존 공통 `ui-field field-group`으로 구성했다. 이름과 삭제 버튼은 Layout에서 가로 배열을 명시한다.

### 공통 검사와 생성물

네 개의 참조 CSS를 공통 스타일 감사 목록에 포함하면서도 eager UI/modal 번들에는 넣지 않았다. 새 검사 범위에서 발견된 기존 toolbar padding과 list-row gap 중복은 최종 적용값을 유지하며 제거했다. main/viewer CSS 번들과 HTML import map·빌드 메타데이터는 소스 생성기를 통해 갱신했다. 자산 리비전은 `0.36.0-build-ui-p4-20261021`, 데이터 리비전은 기존 `data-7bc7903eb13f89dd317166807b636446`이다.

기존 `check-ui-architecture.mjs`는 editor 시작부터 14,000자만 잘라 검사해 P3의 커진 편집기에서 정상 content를 놓쳤다. 대상 요소의 실제 닫는 태그까지 검사하도록 수정했다. 긴 정상 Surface를 허용하는 경우와 뒤의 다른 Surface가 누락된 content를 대신 충족해서는 안 되는 경우를 회귀 테스트로 추가했으며, 두 경우 모두 수정 전 실패·수정 후 통과를 확인했다.

## 검증 결과

Linux의 Chromium `141.0.7390.37`과 저장소 Playwright `1.62.1`을 사용했다. 지정된 Playwright 브라우저 다운로드가 실패하여 설치 가능한 공식 Chromium 바이너리를 별도로 지정했으며, 제품 의존성과 lockfile은 변경하지 않았다.

| 검사 | 최종 결과 | 확인 범위 |
| --- | --- | --- |
| 관련 단위·staging 테스트 8개 파일 | **56/56 통과** | Surface 설치·재설치, 편집 UI, 취소, 구조·스타일 catalog, 검사기 경계, 앱 자산 복사 |
| `pnpm check:ui` | **통과** | spacing·components·architecture·layering·IA, 객체 registry 4건, Surface 상태 14건 |
| Surface 구조·UX Playwright | **20/20 통과** | 최초 직접 부착, 단일 요소·이벤트·포커스, 지연 CSS 4개와 재열기, 라이트·다크 필드 외형·포커스, 반응형 배치·너비 조절·작업 취소 |
| 보조 보정·overlay Playwright | **12/12 통과** | 선 보강·자동 추적 미리보기와 취소, 원본 보존, 목록·탭, 삭제·Undo/Redo, 지도 입력·터치, 회전·기준점·저장·재시작 복원 |
| 공개 웹 viewer Playwright | **2/2 통과** | 데스크톱↔모바일 검색 DOM·포커스 유지, 가로→세로 회전 |
| 실제 앱 staging·check-stage | **통과** | `small-project` 실제 배포 디렉터리 생성 및 자산 정합성 |
| 실제 staged 앱 Chromium 실행 | **통과** | 공통 Surface 첫 부착, CSS 200 응답, 업로드·저장, 도킹·접기·재열기·모바일 snap과 DOM 유지 |
| 변경 JS·테스트의 ESLint, `git diff --check` | **통과** | 변경 범위 정적 검사 |
| 빌드 메타데이터 `--check`, UI 번들 소스 정합성 | **통과** | 생성 HTML/CSS·import map·자산 리비전 |
| Windows Tauri·Android 실제 WebView | **미실행** | 브라우저 기반 staged 앱 검증과 별개이며 P6에서 확인할 항목 |

최종 Playwright는 **총 34개 고유 테스트**를 실행했다. 구조·UX 20개, 보조/overlay 11개, 종합 시나리오 1개, 공개 viewer 2개를 나누어 검증했으며 실패를 skip하거나 허용오차를 완화하지 않았다.

최종 반응형 범위는 `320×720`, `390×844`, `768×1024`, `1024×768`, `1440×900`, `844×390`이다. 추가로 `640×360` 가로 화면을 확인했고, 수정 과정에서는 `320×568` 작은 화면도 확인했다. 모바일 내비게이션을 덮지 않는 높이, 가로 스크롤, 버튼 클릭 영역, 지도 입력 공간, 포커스·ARIA·모션 감소 설정을 검사했다.

### 실제 앱 패키지 실행

`apps/web-shell/dist`를 별도 포트에서 제공하고 새 브라우저 컨텍스트로 실행했다. 생성된 패키지는 **1,122개 파일, 62,381,932바이트**이다. 런타임 catalog·참조 모듈·전용 CSS 9개 자산의 원본 일치를 확인했고, 네 지연 CSS가 현재 리비전으로 HTTP 200을 반환했다.

패널은 완성된 상태로 workspace에 한 번만 추가되고 launcher는 원래 도구바 부모를 유지했다. 이미지 업로드 후 원본 bytes를 비교했다. 데스크톱 dock은 340px이며 지도는 dock 경계에서 끝난다. `390×844`에서 본문 client/scroll 폭은 모두 388px이고 문서 폭은 390px이다. 접기·확장과 snap `0→1`, 닫기·재열기 후 저장 데이터·고정 요소·CSS 개수를 유지했다. 페이지 오류·콘솔 오류·실패 요청은 모두 0건이다.

stage의 진단 패널이 모바일 클릭을 가리는 첫 시도는 별도로 남겼다. 이후 진단 패널의 정상 summary 버튼으로 접고 검사했으며, 제품 CSS를 주입해 가리지 않았다. 이 결과는 **실제 Tauri WebView 기동 결과가 아니다**.

### 검사 과정에서 확인하고 처리한 사항

1. 최초 구조 검사는 기존 구현의 map→workspace 이중 부착과 설치 시 재구성을 실제로 탐지했다. 새 구현에서는 최초 부착 때부터 완성된 구조이며 설치와 재설치로 요소가 늘어나지 않는다.
2. `gis-form-grid` 제거 후 입력 높이뿐 아니라 색·테두리·focus ring도 공통 필드에 다시 연결해야 했다. 독립 리뷰에서 이를 재현하고 다섯 필드에 `ui-field field-group`을 적용했다. 실제 factory와 editor markup의 계산된 외형·포커스를 공통 field-group과 비교하는 라이트·다크 테스트를 추가했다. 수정 전 실패·수정 후 통과했으며 독립 리뷰의 미해결 지적은 없다.
3. 기존 브라우저 fixture 일부는 지연 기능이 첫 클릭 전에 존재한다고 가정했다. 실제 launcher 클릭 뒤 API·복원 상태를 기다리도록 수정했고, 저장·Undo·원본 bytes 검증은 유지했다.
4. 첫 30건 실행은 28건 통과, 2건 실패였다. 하나는 테스트 서버의 `route.fetch: ECONNRESET`으로, 최종 해당 시나리오 재실행에서 재현되지 않았다. 재시도 로직이나 테스트 skip은 추가하지 않았다.
5. 다른 실패는 세계 전체 배율에서 이미지를 45° 회전할 때 모서리가 위도 `89.999` 한계에 잘리는 기존 조건이었다. 기준 HEAD와 P4를 같은 조건에서 비교해 둘 다 약 `38.1111°`로 재현했다. 업로드 전에 정상 휠 조작으로 배율을 2 이상으로 높이면 두 구현 모두 45°를 만족한다. 종합 테스트의 초기 배율만 조정하고 `toBeCloseTo(45, 8)` 및 이후 드래그·보정·Undo/Redo·저장 복원 검증을 그대로 유지해 통과했다. 보정·지도 계산 코드는 변경하지 않았다.

## 재현 명령

```bash
node --test --test-isolation=none \
  tests/unit/reference-image-surface.test.mjs \
  tests/unit/reference-image-ui.test.mjs \
  tests/unit/reference-image-architecture.test.mjs \
  tests/unit/reference-image-workflow-cancel.test.mjs \
  tests/unit/reference-image-analysis-compat.test.mjs \
  tests/unit/ui-source-catalog.test.mjs \
  tests/unit/ui-architecture-surface-boundary.test.mjs \
  apps/web-shell/tests/stage.test.mjs
pnpm check:ui
node scripts/generate-build-metadata.mjs --check

# 환경에 맞는 Chromium 경로를 PANDOLAB_BROWSER_EXECUTABLE에 지정한다.
pnpm exec playwright test \
  tests/browser/reference-image-surface-structure.spec.mjs \
  tests/browser/reference-image-ux.spec.mjs \
  tests/browser/reference-image-auxiliary-surface.spec.mjs \
  tests/browser/reference-image-overlay.spec.mjs
pnpm exec playwright test tests/browser/search-stable-surface.spec.mjs --grep viewer

node apps/web-shell/stage.mjs --profile=small-project
node apps/web-shell/check-stage.mjs
```

## 남은 단계와 반영 범위

P5의 선 보강·자동 추적 버튼 행 재배치 제거는 아직 수행하지 않았다. 두 컨트롤러의 작업 상태와 기존 버튼 이동은 유지하며, P4가 그 동작을 깨뜨리지 않는지만 검증했다. P6의 전체 기능·실기기·네이티브 WebView 검증도 이 보고서의 완료 범위에 포함하지 않는다.

지도 데이터·저장 모델·공유 C++/WASM 계산은 변경하지 않았다(`not-applicable`). 구현·관련 테스트·생성물·보고서를 `work/ui`에 기록한다. `main` 병합, Pages 게시, 네이티브 설치 파일 배포는 수행하지 않았다. 이 보고서는 P4의 최초 구현 및 집중 검증 판본이다.
