# DEV-081 — 1989년 소련 지도 이동 시 GPU·메시 재사용 조사

> 조사 ID: `DEV-081` · 상태: `verified-web-only` · 지도 반영: `not-applicable` · 기록일: 2026-10-16
> 조사 소스: `work/objects`, 테스트 작성 `46ecfc84575d032d911b2fb4a531cbcbb926e3ac`, 실행 커밋 `da831da3e0e9286f18a0ca5253255ee38d519e73`
> 실행 증거: [GitHub Actions 38857758047](https://github.com/kimjeon-il/Pando/actions/runs/38857758047) · `soviet-camera` Job 116832942319, Playwright 1/1 통과

## 대상 및 방법

실제 역사 프로젝트의 월을 `1989-06`으로 설정하고, `state:soviet-union` 엔터티가 존재하며 다중 폴리곤 지오메트리가 로드됐음을 확인했다. 지도는 평면 투영으로 바꾸고 소련을 선택·초점 이동한 뒤 초기 GPU/Worker 작업을 준비, 한 차례 카메라 이동으로 워밍업하고 안정화했다. 동일 선택 상태에서 마우스로 세 차례 평면 pan `(30,12), (-28,-8), (22,10)` 픽셀을 수행했다. 기능·형상·기간 자료는 수정하지 않았다.

테스트 환경: GitHub-hosted Ubuntu 24.04, Playwright Chromium(WebGL2), 뷰포트 1440×900. 이 CI는 **특정 사용자 PC의 실제 GPU/드라이버가 활성화됐다는 증거가 아니며**, WebGL2 API 경로에서의 재사용 검증이다. 실물 GPU 신원 및 드라이버 메모리는 측정하지 않았다.

## 실제 관측값

`SOVIET_1989_PAN_GPU_REUSE` 로그 (해당 실행의 before/after 누적 카운터):

| 지표 | pan 전 | pan 후 | 변화 |
| --- | ---: | ---: | ---: |
| 실제 렌더러 | webgl2 | webgl2 | 없음 |
| WebGL context 개수 | 1 | 1 | 0 |
| viewRenderCount | 103 | 132 | +29 |
| polygonCacheMisses | 33 | 33 | 0 |
| strokeCacheMisses | 2 | 2 | 0 |
| triangulationMs 누계 | 0 | 0 | 0 (Worker·WASM 계산 시간 전체를 의미하지 않음) |
| polygon GPU buildCount | 33 | 33 | 0 |
| polygon GPU uploadBytes 누계 | 256,856 | 256,856 | 0 |
| stroke GPU buildCount | 8 | 8 | 0 |
| stroke GPU uploadBytes 누계 | 13,162,896 | 13,162,896 | 0 |
| countryPatchUploadBytes 누계 | 0 | 0 | 0 |
| paletteUploadCount | 14 | 14 | 0 |
| meshSwitchCount | 2 | 2 | 0 |
| countrySharedBoundaryRequestId | 3 | 3 | 0 |

GPU 기본 메시의 `meshVariantBytes`는 미리보기 3,755,216B, 정본 32,634,708B로 측정 전후 동일했다. 웹 콘솔의 `pageerror`는 0건이었다. 위 관측에 대해 테스트 assertion 1개가 통과했다.

`viewRenderCount` 증가는 의도한 화면 재렌더링이며 GPU 메시 재생성·재업로드를 뜻하지 않는다. 대상 조건에서 별도 메시에 대한 캐시 미스나 버퍼 생성·업로드가 증가했다는 근거는 없다. **웹 평면 WebGL2의 일반 pan 경로는 수정 불필요**.

## 정적 코드 검토와 추가 조사 범위

- 웹 정본: `assets/js/modules/map-render-coordinator.js`의 VIEW 무효화는 장면 메시 변경과 분리되어 있으며, `gpu-map-renderer.js`의 카메라 이동은 기존 GPU 버퍼를 참조한다. 장면 재그리기 및 GPU 버퍼 재생성은 서로 다른 작업이다.
- 신규 웹 UI 앱: 기존 웹의 WebGL/Canvas·WASM·Worker 렌더링 경로를 실행하는 Windows WebView2 및 Android WebView 환경을 조사한다. `apps/web-shell/`은 별도의 시험용 프로토타입이므로 완성 앱과 동일하다고 간주하지 않는다.
- **Qt 앱 조사 제외 (사용자 범위 변경, 2026-10-16):** Qt 앱은 새 웹 UI 앱으로 교체될 예정이므로 앞으로의 원인 분석, CPU fallback 확인, 코드 수정, 성능 회귀 검증에서 제외한다. 이전 판본에 포함된 Qt 정적 검토는 당시의 기록일 뿐, 웹 UI 앱의 GPU 동작을 설명하는 근거로 사용하지 않는다.
- 이번 실행은 실제 사용자 PC/WebView의 GPU 드라이버·물리 GPU 가속 여부, FPS/체감 지연의 원인별 비율, GPU VRAM, JS+WASM 힙/RSS, 지구본 회전·지도 축척 변화는 확인하지 않았다. 특히 소련의 고정밀 메시 최초 준비 지연과 메모리 보유량은 이번 pan 증분 검사와 별개다.

## 판정 및 변경

웹 코드의 동일 장면 이동에서 불필요한 GPU 메시 재생성·업로드는 재현되지 않았으므로, production 렌더링/계산 코드에 근거 없는 최적화 변경을 하지 않았다. 신규 검사는 `tests/browser/performance-observability.spec.mjs`이며 전용 최소 CI `.github/workflows/soviet-pan-gpu-regression.yml`에서 실제 실행됐다.

주의: 자동 실행된 기존 P3(38857487033)의 `browser-regression`은 건너뛰었으므로 그것을 성공 근거로 사용하지 않았다. 별도의 38857758047에서 직접 수행한 테스트만 성공 증거다. 해당 실행은 stdout 로그를 보존했지만 테스트용 아티팩트 업로드는 `test-results/` 파일 부재로 생략되었다.

후속으로는 **브라우저 및 새 웹 UI 앱(WebView)** 의 실제 GPU/소프트웨어 렌더러 선택, 소련 표시 시 첫 메시 준비시간, 전체 장면 그리기와 선택 SVG의 시간 비중, Worker/WASM 작업 및 CPU·GPU 리소스 생존량을 구분 계측한다. **Qt 앱은 후속 조사에서 제외한다.** 별도 사용자 지시 없이 GIS 원본 또는 화면 표시 형상은 바꾸지 않는다.
