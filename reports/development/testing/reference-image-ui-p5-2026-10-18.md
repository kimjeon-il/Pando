# 참고 이미지 UI P5 — 회귀 검증과 조작 영역 수정

> 보고서 ID: `DEV-REF-UI-P5-20261018` · 상태: `verified-feature-branch / integration-pending` · 지도 반영: `not-applicable` · 색인일: 2026-10-18  
> 원문 최종 수정: 2026-10-18  
> 조사 기준: 웹·앱 공통 기준 커밋 `94bbb47fbbf59fa666dbccc4af85ef536ba64dac` + 이 보고서와 함께 제출한 P5 변경  
> 원본·출처: [Draft PR #134](https://github.com/kimjeon-il/Pando/pull/134), [실행 요약·소스 해시](reference-image-ui-p5-evidence.json)

## 대상과 기준일

P1–P4에서 변경한 참고 이미지 도킹 패널, 목록·탭, 직접 조작, 기준점·선 보정·자동 맞춤의 안내·미리보기·취소를 검증했다. P4에서 최소 검사만 수행하고 P5로 남긴 실제 브라우저·반응형·키보드·앱 영향 확인이 대상이다.

검증 대상은 승인된 기존 `feature/reference-image-p1-layout-20261018` 브랜치다. 실행 도중 `work/ui`에 들어온 별도 웹 뷰어·앱 편집기 분리는 아래의 통합 후속 사항으로 구분했다. 이 결과를 최신 `work/ui`, 배포된 웹, Windows 또는 Android 네이티브 앱 전체의 검증으로 해석하지 않는다.

## 근거와 방법

- Linux에서 Node `24.19.0`, pnpm `11.25.0`, Playwright `1.62.1`, Chromium `151.0.7922.34`를 사용했다. 저장소의 CI 설정은 Node 22 / pnpm 11.19.0이다.
- 참고 이미지 검사는 기존 `staticAutosaveProject()`와 PNG fixture를 사용했다. 실제 파일 입력, IndexedDB, 이미지 디코딩, 매핑, 지도 입력, 탭·패널·취소 동작을 실행했다. 무관한 전체 세계지도 초기화를 해당 도구 검사의 준비 조건으로 삼지 않았다.
- 저장 불변 검사는 기준점·`mapQuad` 등 레코드 전체와 원본 Blob의 MIME type·크기·바이트를 비교했다. 해당 테스트에서는 runtime mapping 정보도 비교했다.
- 반응형 검사는 light/dark 각각 320×568, 390×844, 768×1024, 1024×800, 1440×900에서 배치·맞추기·표시 탭을 확인했다. 화면 경계, 가로 넘침, 지도와 dock 경계, 모바일 하단 메뉴, 손잡이 터치 크기를 실제 DOM 좌표로 검사했다.
- 단위 테스트는 파일별 독립 Node 프로세스로 실행하고 실제 case 수를 합산했다. 이 실행 환경의 `node --test` 요약이 파일 수를 표시하는 경우를 개별 case 수로 오인하지 않았다.

초기 Chromium 다운로드 응답이 ZIP 대신 오류 HTML이어서 실행 환경을 복구했다. 이후 외부 terrain 요청의 인증서 오류도 실행 환경의 기존 신뢰 루트를 Chromium에 반영해 해결했다. HTTPS 오류 무시 옵션이나 console 오류 필터를 추가하지 않았다. 이 환경 문제로 실패했던 실행을 통과 건수에 포함하지 않았다.

## 발견한 문제와 수정

| 실제 재현 | 원인 | P5 수정과 확인 |
| --- | --- | --- |
| 320px 모바일 손잡이가 패널 왼쪽으로 7px 이탈하고 높이가 4px가 됨 | 44px grid 열에 공통 96px 너비가 적용되고, 정의되지 않은 모바일 높이 토큰이 최소 높이를 무효화 | 참고 이미지 손잡이 너비를 열에 맞추고 기존 `--ui-touch-height` 사용. 실제 너비·높이 44px 이상 검사 통과 |
| 기준점·자동 분석 중 일반 완료·취소 버튼이 중복 표시됨 | 비활성 선 보강·자동 추적 controller가 surface의 버튼 숨김 상태를 덮어씀 | 공용 버튼 표시는 surface가 소유. 실제 두 controller를 설치하는 unit 회귀는 수정 전 3개 실패에서 수정 후 8/8 통과. 모바일 GCP·자동 분석의 버튼 숨김도 브라우저에서 확인 |
| 모바일 보조 도구를 펼치면 적용·취소가 사라지고, 접힌 상태의 버튼 폭이 24px로 줄어듦 | summary의 `hidden` 변경을 관찰하지 않아 action row가 숨은 부모에 남음. 행도 summary의 전체 너비를 쓰지 못함 | 두 controller가 summary 표시 변경을 기존 sync 경로에 연결. action row 전폭 및 최소 터치 폭 적용. 두 도구의 실제 armed/preview, 펼치기·다시 접기·취소 검사 통과 |
| desktop 1440×900에서 기준점 직접 편집 종료 버튼을 누를 수 없음 | 선택 이미지·workflow·탭의 고정 높이 아래 작업 scrollport가 0px로 축소됨 | workflow가 있는 desktop editor 전체를 스크롤하도록 조정. 실제 `elementFromPoint()`와 일반 클릭, 이어지는 Undo·저장·모바일 흐름까지 통과 |

보조 도구의 펼친 버튼은 단순 DOM 존재 외에도 정상 `click({ trial: true })`, 화면 내 위치, 최소 너비, 중심점 hit-test로 확인했다. 실제 Apply를 누르는 대신 취소 후 원본 상태가 유지되는지 검증했다.

기존 workspace DOM 재사용 테스트도 바로잡았다. desktop에서 열린 패널은 mobile 전환 후에도 열림을 유지하는 계약인데, 종전 테스트가 한 번 더 toggle하여 패널을 닫았다. 열린 상태·ARIA·DOM identity를 직접 검사하도록 변경했고 전체 4개가 통과했다. 제품의 공유 surface 코드는 이 문제 때문에 변경하지 않았다.

## 실행 결과

| 검사 묶음 | 고유 case 수 | 결과와 범위 |
| --- | ---: | --- |
| 참고 이미지·공유 runtime 단위 | 166 | 통과. 매핑·변환·저장·편집 bridge·입력·workflow 취소·UI 및 surface |
| 인접 입력·surface·UI 계약 단위 | 46 | 통과. 위 묶음과 합해 28개 파일, 212/212 |
| 앱·host·파일 경계 단위 | 59 | 통과. 앱 8개 파일 24개 + 공통 host·파일 8개 파일 35개 |
| 기존 참고 이미지 browser | 13 | 12개 통과 후 실패한 마지막 조작 사례를 수정·재실행해 통과 |
| 신규 반응형·키보드·GCP·모션 browser | 14 | 마지막 생산 수정 기준 전체 fresh run 통과. 입력 해시 전후 동일 |
| 신규 자동 분석 취소 browser | 2 | 마지막 생산 수정 기준 desktop/mobile 통과 |
| 신규 모바일 보조 도구 browser | 2 | 실제 preview, 펼치기·접기, 버튼 접근, 취소·저장 불변 통과 |
| 공유 workspace browser | 4 | 현행 열림 유지 계약으로 전체 통과 |
| UI 정적 검사·ESLint·CSS 구문·diff | — | 관련 파일 및 `pnpm check:ui` 통과 |

단위 검사는 합계 **271개**, browser는 고유 시나리오 **35개**다. browser 수는 수정 전 실패·수정 후 재실행을 별도 case로 더하지 않은 수이며, 하나의 35개 일괄 실행 결과를 뜻하지 않는다. 생산 변경 후에는 원인과 연결된 실패 경로 및 반응형 14개, 자동 분석 2개, 모바일 보조 도구 2개를 다시 확인했다. 앱/host 59개의 대상 소스는 P5에서 바뀌지 않아 불필요하게 반복하지 않았다.

Reduced motion은 실제 media 설정을 전환해 computed style을 비교했다. 정상 상태의 panel 전환은 0.17초, launcher는 0.14초였다. reduced motion에서 둘 다 `transition-property: none`이고 duration은 각각 0.00001초와 0초였다.

### 앱 staging

마지막 생산 수정 후 `node apps/web-shell/stage.mjs --profile=small-project`를 실행하고, 별도 스크립트로 산출물과 원본을 비교했다.

| 항목 | 확인 결과 |
| --- | --- |
| 산출물 | 893개 파일 / 55,751,675 bytes, 전체 파일 SHA-256·크기 일치 |
| 작은 프로젝트 fixture | 3 entities / 15 coordinates |
| 원본과 그대로 같은 파일 | 867개 |
| 의도된 변환 | Worker 20개 request guard, build metadata profile 추가, HTML bootstrap 교체 |
| 참고 이미지 공유 자산 | JS 24개 + CSS 4개, 웹 원본과 바이트 단위 동일 |
| 인접 host/input/file 자산 | JS 14개, 원본과 동일 |
| Import map·WASM | reference target 24개 해석 가능, 기존 WASM pair의 핀 해시 일치 |

staging 시점의 기준 HEAD는 `94bbb47`이며 tracked diff SHA-256은 `a96f2938fa5db0bd0fcc10c58f801876442a433680564e77934ff27a5e15dafe`였다. stage 기록과 독립 계산값이 일치했다. 이후 변경은 검사 보강과 이 보고서·증거 정리이며 생산 자산은 동일하다. 증거 JSON에 검증한 공유 소스 42개의 개별 SHA-256을 보존했다.

### 대표 화면과 기계 판독 증거

- [320px 기준점 지도 선택 단계](../../images/reference-image-ui-p5/mobile-320-gcp.png)
- [Desktop dark 맞추기 탭](../../images/reference-image-ui-p5/desktop-dark-match.png)
- [접힌 desktop 패널의 기준점 안내](../../images/reference-image-ui-p5/desktop-gcp-guide.png)
- [모바일 자동 분석·분석 취소](../../images/reference-image-ui-p5/mobile-auto-analysis.png)
- [모바일 선 보강 미리보기](../../images/reference-image-ui-p5/mobile-line-preview.png)
- [펼친 모바일 자동 추적의 적용·취소](../../images/reference-image-ui-p5/mobile-live-expanded.png)
- [결과 요약·소스 해시·모션·버튼 hit-test](reference-image-ui-p5-evidence.json)

## 확인 한계와 최신 기준 브랜치 후속 사항

**네이티브 Windows·Android 앱 실기동은 수행하지 않았다.** Tauri `invoke`와 파일 선택 등의 단위 검사에는 test double이 사용된다. staging과 공유 소스 일치는 Rust IPC, OS 파일 선택기, Windows WebView2, Android 기기의 실행 성공을 뜻하지 않는다. portable package나 전체 world 데이터 묶음도 만들지 않았다.

자동 분석 browser 2개는 플랫폼 `TextDetector.detect()` 응답만 지연시켜 취소 후 늦은 결과가 새 GCP 작업을 덮어쓰지 않는 것을 검증한다. 성공 OCR의 인식 정확도나 성공 자동 맞춤 전체 경로를 검증한 것은 아니다. 기존 선 보강·자동 추적 첫 browser 사례는 적용 bridge를 test double로 대체하므로 그 결과만으로 실제 네이티브/C++ draft 최종 적용을 주장하지 않는다. 새 모바일 보조 도구 검사는 fake 없이 실제 preview를 만들고 취소한다.

검증 중 `work/ui`가 공통 기준 `9a20fe99202e8cc9050acfef3441c6952deb4421`에서 `71afae2f0e0f4e64328ebf5e71a622bd1be58799`로 전진했다. 이 별도 변경에는 웹 viewer와 앱 editor의 진입 문서 분리가 포함된다. 최신 `/`는 viewer이며, 기존 editor 테스트는 `tests/browser/helpers/editor-entry.mjs`의 `gotoEditor()`를 사용한다.

이번에 추가한 `reference-image-ux`, `reference-image-auto-workflow`, `reference-image-auxiliary-surface` 세 spec은 현재 P5 브랜치의 실제 editor 진입인 `/`를 검사한다. 최신 base와 통합할 때 세 파일을 기존 canonical `gotoEditor()`로 전환하고 통합 checkout에서 재검증해야 한다. 현재 P5 HEAD에는 그 helper와 editor 문서가 모두 없으므로 import만 앞서 추가하지 않았다. helper 존재 여부 fallback, 새 환경변수 경로 계약, CI assertion 완화도 추가하지 않았다.

따라서 **이 보고서의 PASS는 검증한 feature 브랜치에 한정한다. 최신 base의 PR 통합 CI 성공을 뜻하지 않는다.** Reference Image Integration matrix에 신규 `ux`, `auto-workflow`, `auxiliary-surface`를 연결했으며, 원격 실행 상태와 후속 통합 조건은 Draft PR에 기록한다.

## 데이터 반영과 판본

지도 데이터 반영은 `not-applicable`이다. P5 제품 변경은 참고 이미지 layout CSS 1개와 surface/auxiliary JS 3개다. 이미지 보정 solver, 원본 Blob·IndexedDB 형식, Undo 엔진, 공통 C++ 코어에는 P5 변경이 없다.

이 보고서는 P4에서 미실행으로 남긴 검증의 후속 기록이다. 이전 단계의 최소 검사 기록을 새 결과로 덮어쓰지 않는다. 최신 `work/ui` 통합 또는 네이티브 실기동을 검증하는 후속 판본이 생기면 그 대상 SHA와 범위를 별도로 연결한다.
