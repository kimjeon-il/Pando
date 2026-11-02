# W2-P5-2 — 공유국경 Worker 오류 롤백 검사 보완

날짜: 2026-11-02 (Asia/Seoul). 제품 코드 변경 없이 기존 **검사 도구의 재현성·관측 범위**를 보완한다. 이번 테스트를 Windows GTX 1650 성능 측정으로 혼동하지 않는다.

## 이전 검사 실패와 구분할 사항

기존 tools/w2-p5-2-rollback.mjs의 실측 보고서는 PandoLab-library-data@a2a22c338c5924a83413e449647f4a9b172100e4의 reports/development/performance/w2-p5-2-windows-gpu-2026-11-02/rollback.json 및 rollback-retry.json에 기록돼 있다. 모두 120초 대기 시간 초과였고 **Worker protocol error가 실제로 렌더러에서 처리됐는지 확인하지 않았다**. 기존 판정은 미검증이며 제품 rollback 결함을 의미하지 않는다.

원인 후보: 진단용 globalThis.__w2Current는 shared GPU Worker channel의 마지막 메시지로 반복 덮어써질 수 있다. 또한 연도 전환에서 기존 인증된 국경을 재사용하면 새 Worker 요청이 존재하지 않을 수 있다. 조건 없는 __w2Current.type==='error' 폴링은 신뢰할 수 없다.

새 회귀 파일: tests/browser/viewer-temporal-boundary-worker-rollback.spec.mjs. Work/ui 검증은 .github/workflows/viewer-temporal-boundary-worker-rollback.yml로 실행한다.

## 검사 구현 및 실제 검증 사항

1. Playwright page.addInitScript로 Worker 객체를 진단 인스턴스에서만 감싸고 실제 Worker 옵션 name pandolab-country-shared-boundary를 식별한다. 제품 Worker 내부 코드는 고치지 않는다.
2. 초기 WebGL 지도와 국가 경계가 준비될 때까지 대기한다. 이후 첫 연도 전환의 정확한 새 projectGeneration을 계산하고 해당 세대 국경 준비만 test-only로 강제한다.
3. 진단 Worker boundary channel에 새로운 requestId, projectGeneration, geometryRevision, quality를 그대로 사용해 **일치하는 type=error 메시지 한 건**을 재현한다. 후속 메시지는 실제 Worker로 전달한다. 이것은 Worker protocol 오류를 **주입하는 검사**이지, 실제 Worker 계산 중 예외가 자연 발생했다고 주장하지 않는다.
4. 한 메시지가 아니라 request-intercepted, dispatched, renderer-received 세 독립 사건을 기록한다. Worker message가 다른 GPU 응답으로 덮어써질 위험을 제거한다.
5. 프로젝트가 rollback 후 더 큰 세대를 부여받고, 기존 날짜/cursor/document ID, 국가·geometry·timeline·SVG label 의미 SHA를 회복하며 countrySharedBoundaryReady, canonicalMeshReady, countriesPublishedGeneration==projectGeneration, projectRenderBlocked=false를 충족하는지 확인한다.
6. 오류 알림 및 시점 이동 패널은 **정상적인 실패 UI**이므로 실제 canvas 픽셀 검사에서 숨긴다. 두 캔버스 이미지를 디코딩해 채널별 실제 차이 픽셀 수를 직접 계산하고 0인지 확인한다. 첫 CI에서 UI overlay가 85,066 픽셀 비교 차이를 일으켰으나 UI 제외 캔버스 비교는 0이었다.
7. 오류 주입은 한 번만 수행하고, 재시도에 다시 원래 연도로 이동해 날짜/cursor/경계/새 지도 frame이 모두 정상 인증되는지 확인한다.

**한계**: Linux GitHub CI는 Ubuntu Chromium 조건이며 물리 NVIDIA GPU가 아니다. 실제 Worker의 WASM 계산에서 발생한 비합성 예외, Windows GTX1650 전용 rollback, 연속된 다중 오류와 급격한 월 전환, 장기 메모리는 별도 검사해야 한다.

## Windows 기존 pinned 서버에서 재검증

기존 w2-p3-after detached 소스/미완성 WASM/manifest/캐시/미커밋 파일 및 기존 287개 증거는 덮어쓰지 않는다. work/ui의 현재 browser 회귀 파일과 Playwright toolchain을 사용하되 pinned server는 제품 소스 fe8282ba32761ab9586348d1712e11cc1f4e7882, 자료 라이브러리 5eb7be55208efaafe39bd5a65ec2f111d70b9053을 유지한다.

PowerShell 터미널 1:
~~~
$env:PANDOLAB_W3_EVIDENCE='D:/dev/PandoLab-library-data/reports/.edits/ui/development/performance/<new-unique-scope>'
node tools/w2-p5-2-server.mjs
~~~

터미널 2, **같은 work/ui 체크아웃**. 이 환경에서만 실제 GTX1650/드라이버/ANGLE D3D11 및 기준 소스·자료 버전을 자동 확인한다:
~~~
$env:PANDOLAB_TEST_PORT='4221'
$env:PANDOLAB_W5_REQUIRE_GTX1650='1'
pnpm exec playwright test tests/browser/viewer-temporal-boundary-worker-rollback.spec.mjs --workers=1 --retries=0 --repeat-each=2 --trace=on --output='test-results/w2-p5-rollback-gtx1650-new-scope'
~~~

W2-P5-2의 고정 소스와 데이터 핀이 다른 서버가 4221번 포트에서 응답한다면 실행을 중단한다. 실제 NVIDIA GTX1650, driver 32.0.16.1088, Chromium 151, ANGLE D3D11 및 GPU compositing 확인 실패도 성공으로 처리하지 않는다. 기존 보고서와 결과 디렉터리를 재사용하지 말고 위 output을 새 고유 경로로 변경한다. Playwright 출력/trace/PNG와 console의 W5_BOUNDARY_ROLLBACK_PASS를 원시 증거로 보존한다. Windows 실측 결과는 CI Linux 검증과 별도 판정한다. 프로젝트 보고서 발행 규칙을 따르고 원시 바이트 재검증을 수행한다.

## 실제 CI 검증 기록

- Linux Chromium 회귀 실행: https://github.com/kimjeon-il/Pando/actions/runs/41461767199
- 검증 소스: GitHub work/ui@7c7df2a348cecf1b5817c6b818d357349db7b10e, 테스트 코드에서만 256KiB 기본 업로드를 유지한 실제 Viewer.
- 동일한 오류-복구-재시도 회귀 2회 연속 PASS.
- 오류 주입: 2026-11 초기 세대 1에서 사용자가 이전 연도를 요청하면 프로젝트 세대 2/공유국경 requestId 5/geometryRevision 2/quality canonical에 대해 정확한 Worker-protocol 오류 1건을 전달.
- renderer가 matching error를 수신하고 이전 프로젝트·월 2026-11, cursor, document ID, 국가 254개, 형상 254개, timeline 5개, 표시 지명 118개의 각각 SHA가 원래 값으로 복구됨.
- rollback generation 3에서는 canonical mesh ready, boundary ready, countriesPublishedGeneration==projectGeneration, projectRenderBlocked=false 확인.
- 알림/날짜 패널 UI를 제외한 1280×752 GPU canvas 비교에서 **두 회 모두 실제 차이 픽셀 0개**.
- 재시도 시 2025-12가 generation 4에서 새 지도·지명·국경을 정상 승인. 예상치 못한 pageerror 없음.
- 최초 진단이 사용한 __w2Current 임시 값 대신 request-intercepted / error-dispatched / renderer-received 사건을 독립 수집.
- **Linux headless Chromium, 시험용 프로토콜 오류 주입이라는 제한**은 유지한다. 실제 Windows GPU 또는 비합성 Worker 내부 예외를 검증했다는 뜻은 아니다.
- 일회성 CI 실패 기록은 삭제하지 않는다. 초기 비교는 오류 UI까지 캔버스 스크린샷에 포함해 픽셀 차이를 잘못 계산했고, 한 실행의 즉시 해시 불일치 원인은 비동기 표시 상태를 포함할 수 있어 확정되지 않았다. 재검사는 항목별 해시와 같은 재시도 조건을 기록해 두 차례 통과했다. 해당 흔들림을 전체 운영 환경의 무결성 보장으로 일반화하지 않는다.

## 완료 판정

- **검사 수단의 보완**: CI 테스트 완료 여부에 따라 판정, 당시 W2-P5-2 원시 실패는 삭제하지 않는다.
- **실제 브라우저 롤백**: 오류 응답 식별, rollback generation, 데이터/날짜/국경/지명, UI 제외 지도 픽셀, 정상 재시도 모두 통과 시에만 완료.
- **Windows GTX1650 하드웨어**: `PANDOLAB_W5_REQUIRE_GTX1650=1` 검사가 같은 고정 환경에서 모두 통과하고 원시 결과가 저장되기 전에는 미검증.
- 제품 JS/C++/GIS 데이터 및 배포는 건드리지 않고, main 통합은 하지 않는다.
