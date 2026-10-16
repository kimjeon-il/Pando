# DEV-080 — 1989년 소련 WebGL 강조선 및 상호작용 패스 최적화

> 상태: `verified-web` · 지도 데이터 반영: `not-applicable` · 2026-10-16
> 대상 소스: `work/objects` `06ed2806258f830ee8501d2d295c439374b1de34`
> 범위: 브라우저 웹 및 신규 WebView 기반 앱이 공유하는 JS/WebGL 경로. **Qt 앱 분석·변경·검증 제외.**

## 재현·증거

실제 역사적 세계 프로젝트를 `1989-06`으로 변경하고 `state:soviet-union` 객체를 조회했다. Chromium WebGL2에서 평면 지도 이동을 선택 전후 각각 실행했다. 실제 사용자 Windows·Android WebView에서의 풀월드 실측은 수행하지 않았다. GitHub-hosted Ubuntu Chromium에서 보고된 GL 렌더러는 `ANGLE / Vulkan SwiftShader`로 **소프트웨어 구현**이다.

- 초기 GPU 순수 이동: [38857758047](https://github.com/kimjeon-il/Pando/actions/runs/38857758047) · GPU 메시 캐시 미스·추가 업로드 없음
- 선택 강조선 최초 비교/진단: [38860534996](https://github.com/kimjeon-il/Pando/actions/runs/38860534996) · SVG 대체 및 미선택 워밍업 중 지연 업로드 발견; 프로파일 테스트의 엄격한 영(0) 업로드 주장은 초기화 진행 상황과 혼재돼 실패했으며, 생산 코드 회귀 증거로 분류하지 않음
- 역사적 국가 GPU 선택 강조선 수정 `20ebad1e`: [38861614415](https://github.com/kimjeon-il/Pando/actions/runs/38861614415) · 선택용 경계 39,819 GPU 세그먼트, 안정화 후 선택 SVG fallback 0, 지도 이동 중 버퍼 추가 업로드 0B
- 빈 상호작용 채움 마스크·프레임버퍼 생략 `399240da`: [38862006365](https://github.com/kimjeon-il/Pando/actions/runs/38862006365) · 단위 계약 검사 및 Chromium 실제 역사 세계 이동/선택 2개 검사 **모두 통과**

## 확인한 원인과 수정 내용

### 1. 역사적 대형 국가의 GPU 선택 강조선 미연결

`assets/js/modules/rendering-domain.js`에서 최상위 일반 영토는 기본 국가 메시의 내장 경계 리소스가 있다고 가정했다. 하지만 1989년 소련의 ID `state:soviet-union`은 현재 기본 국가 메시에 존재하지 않는다. `selection-pass.js`의 owner-only 요청이 준비된 GPU 패킷을 얻지 못하면서 전체 소련 외곽선이 SVG fallback으로 표시됐다. 이전 테스트는 WebGL2 동작을 확인했지만 **실제로 선택 외곽선이 GPU에 올라갔다는 증거는 없었다.**

이제 `getCountryInteractionBoundaryData().visibleIds`에서 실제 기본 메시 소유 여부를 확인하고, 소유자가 없으면 기존 `cachedSelectionBoundaryFeature` 및 `selectionPass`의 일반 지오메트리 경로를 이용한다. 현재 국가 메시가 실제로 해당 국가를 소유할 때는 기존 버퍼 재사용 경로를 그대로 유지한다. 계산의 정본·원본 좌표·기간·편집 데이터는 바꾸지 않았다.

수정 후 실제 소련 선택 경계는 **39,819개 세그먼트**가 GPU 선택 패스에 전달되고, 초기 업로드 완료 뒤 SVG 대체 경로는 0개다. 안정된 상태에서 몇 차례 평면 이동을 수행해도 선택용 GPU stroke 생성/업로드 누계 증가는 **0**이었다.

선택 데이터가 처음 준비될 때 SVG fallback 경로 문자열을 만드는 과도기 비용까지 0이 된 것은 아니다. 2026-10-16 최종 실행의 선택 메트릭은 초기 준비 중 경로 문자 수 **1,816,658자**를 보고했지만, 안정화 이후 `fallbackCount=0`이었다. 초기 비용은 별도로 분석해야 한다.

### 2. 상호작용 채움이 없어도 실행되는 전체 국경·수계 마스크

`gpu-interaction-pass.js`는 선택 채움 요청이 전혀 없는 이동 프레임에서도 호수·하천·국경선 스텐실 마스크와 상호작용 fill framebuffer를 매번 준비했다. `gpu-scene-preparation.js`에서 실제 선택/미리보기/초안/일반 채움/국가 채움 범위 존재 여부(`hasFillItems`)를 계산하도록 했다. 이 값이 false인 프레임은 `gpu-map-renderer.js`에서 fill 캐시 framebuffer 준비를 생략하고, `gpu-interaction-pass.js`에서 관련 마스크 및 fill 합성을 건너뛴다. GPU 선택/초안 **선 그리기**는 계속 수행한다. 채움이 존재하는 정상 경로는 유지한다.

| 동일한 소련 테스트의 비교 지표 | 마스크 생략 전 실행 38861614415 | 생략 후 실행 38862006365 |
| --- | ---: | ---: |
| 소련 미선택: 이동 `viewRenderCount` 증가 | 29 | 29 |
| 소련 미선택: GPU stroke draw-call 증가 | 106 | 56 |
| 소련 선택: 이동 `viewRenderCount` 증가 | 27 | 28 |
| 소련 선택: GPU stroke draw-call 증가 | 144 | 100 |
| 소련 선택: SVG fallback (측정 말기) | 0 | 0 |
| 소련 선택: GPU 강조선 세그먼트 | 39,819 | 39,819 |
| 소련 선택: 이동 중 추가 stroke 업로드 | 0B | 0B |
| 소련 선택: 메모리 구조/정본 수정 | 없음 | 없음 |

미선택 draw-call은 **50회 감소(약 47%)**했다. 선택 상태의 두 실행은 이동 프레임 수가 달라 단순 총량으로 정량적 성능 향상을 주장하지 않는다. 같은 hosted SwiftShader 장비군이라도 A/B가 통제된 교대 프로파일이 아니므로 CPU frame p95나 heap 크기를 정확한 개선율로 환산하지 않는다.

## 검증 범위와 후속 병목

- [38862006365](https://github.com/kimjeon-il/Pando/actions/runs/38862006365): `selection-overlay-plan`, `selection-entity-channels`, `gpu-prepared-draw` 관련 Node 단위 계약 단계 성공. 실제 Chromium `1989 Soviet Union pan` 1/1, `1989 Soviet WebGL interaction work with and without selection` 1/1 성공.
- 1989년 소련의 **선택 후 단순 평면 이동**은 GPU stroke 버퍼 재생성·재업로드 없이 렌더링된다. 기존 국가와 역사적 객체의 선택 소유 경로를 분리하여 원본 경계를 유지했다.
- `sceneCacheFullDrawCount`가 카메라 이동 중에도 증가한다(최종 프로파일 선택: 28개 view frame에 기본 장면 전체 redraw 12회, 작은 이동 재투영 14회). 이는 현재 화면 캐시의 제한에 따른 후속 렌더링 비용이지 메시 재업로드 증거가 아니다.
- 선택 준비의 SVG 과도기 경로 생성, 메인 스레드 초기 장시간 작업, WebGL GPU 명령 실제 실행시간, JVM/WASM Worker 메모리, 전체 GPU VRAM/메모리 생존, 사용자 장치의 물리 GPU 가속은 **아직 별도 검증 필요**.
- `apps/web-shell` Tauri 시험용 앱은 전체 역사 세계 대신 좌표 100개 미만인 소형 fixture만 포함한다. 코드 개선은 그 앱이 기존 공통 웹 렌더러를 사용할 때 적용되지만, 소련 실기기 성능이 검증됐다는 의미는 아니다.
- 측정 중 첫 미선택 이동에는 초기 Worker/경계 자산 준비에서 이어진 비동기 GPU stroke 업로드가 기록되는 경우가 있었다. 비교 시작 시 모든 업로드가 끝나기 전의 값을 “이동이 야기한 재업로드”로 분류하지 않았다. 선택 상태의 워밍업 완료 후 검사에서는 업로드 증가가 없었다.

## 적용 및 보존

프로덕션 수정: `assets/js/modules/rendering-domain.js`, `gpu-scene-preparation.js`, `gpu-map-renderer.js`, `gpu-interaction-pass.js`.
회귀 테스트: `tests/browser/performance-observability.spec.mjs`, `tests/browser/soviet-web-render-profile.spec.mjs`, `tests/unit/gpu-prepared-draw.test.mjs`; 전용 CI `.github/workflows/soviet-pan-gpu-regression.yml`.

독립적인 역사 경계 데이터/라이브러리/공통 지오메트리 계산은 수정하지 않았다. Qt 앱 수정·검증, `main` 병합 및 웹 배포는 실시하지 않았다.
