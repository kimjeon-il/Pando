# W2-P3 Windows GTX 1650 최적화 전후 검증

측정일: 2026-11-02. 제품 최적화 추가 구현, main 통합, 공개 배포 없음.

보고서와 원시 JSON/gzip trace/PNG/계측 소스/검사 로그:

`reports/development/performance/w2-p3-windows-gpu-final-2026-11-02/README.md`

외부 저장소: `kimjeon-il/PandoLab-library-data`.
원격 보관 revision: `84d68e4e462457fd0e3d7c86a2088aa081b9b562`.
선택 범위 254개 파일을 발행·원격 바이트 검증했다.

| 조건 | 첫 표시 p50 | p90 | 최대 | 2.5초 초과 |
| --- | ---: | ---: | ---: | ---: |
| A | 3144.0ms | 3363.3ms | 3363.7ms | 7/10 |
| B | 2176.0ms | 2244.8ms | 2274.9ms | 0/10 |
| A 재시험 | 3196.1ms | 3510.9ms | 3930.7ms | 8/10 |

B 첫 표시 p50은 A 대비 30.8%, A 재시험 대비 31.9% 개선됐다.
실제 첫 전환 8/10에서 cache hit, 나머지 2회는 메인 렌더러 재사용으로
Worker 요청이 없었다. 최초 Worker 요청이 있는 경우의 hit는 8/8이다.
startup miss를 포함한 전체 반환 기준 hit는 8/18(44.4%)이다.
첫 패킷 준비 p50은 A 924.842ms / B 1.319ms / A 재시험 929.994ms다.
B는 캐시 적중 때 계산을 생략하며 이 1.319ms는 복사/준비 시간이다.
예열 전환은 약 805–817ms로 실사용 개선이 입증되지 않았다.

GTX 1650 / 드라이버 32.0.16.1088 / Chromium 151.0.7922.34 / 실제
ANGLE D3D11 / WebGL2 / GPU compositing enabled를 매 실행 확인했다.
600회 주 전환의 날짜별 국가·국경·지명·관계·geometry SHA가 같고,
대표 A/B 화면의 두 날짜 픽셀 차이는 0이었다.
성능·자연 경로 캐시 적중·메모리 안정성은 각각 완료로 판정했다.
메모리는 160회 전환과 60회 강제 재준비의 관측 범위이며 무기한 보장이 아니다.
캐시 추정 보관량은 한 패킷 15.79MiB로 일정했고 detach는 없었다.
trace 없는 B 대조의 60→160회 private 증가는 2.95MiB,
국경 Worker heap은 129.7811MiB로 일정했다. GC 전후·trace 수집 영향은
외부 보고서의 memory-verdict.md를 따른다.

## 고정 입력

- A: `7c1c55e2a47b03177104bd4a54452692a80674b1`
- B: `fe8282ba32761ab9586348d1712e11cc1f4e7882`
- 별도 최신 회귀: `ee4cb65ce8f673659b6b436b21f1f62b9ddcad2b`
- data pin: `5eb7be55208efaafe39bd5a65ec2f111d70b9053`
- 실제 data identity: `data-f50b7f480c812df6f5ea0c40f5461ab0`
- A/B 차이는 `country-shared-boundary-worker.js` 한 파일이다.
- W1 69a34dce는 역사적 참고이며 개선율 분모에 쓰지 않았다.

## 재현

기존 detached `D:/dev/worktrees/w2-p3-before`, `w2-p3-after`,
`w2-p3-latest`를 보존했다. W2-P2 worktree/복구본, 현재 work/ui의
미커밋 branch-policy, WASM 및 manifest는 변경하지 않았다.
각 비교 worktree의 tracked source가 clean이고 위 SHA인지 확인한다.
의존성과 동일 pin의 materialized runtime cache는 ui의 기존 것을 재사용한다.

새 재현은 기존 증거를 덮어쓰지 않는 새 report scope에서 수행한다.
PowerShell의 `PANDOLAB_W3_EVIDENCE`를 그 scope의 owner 편집 경로로 지정한다.
`node tools/data/report-paths.mjs reports/development/performance/<new-scope> write`
명령으로 해당 경로를 얻을 수 있다.

1. `PANDOLAB_W3_INSTRUMENT_VERSION=v3`로 `node tools/w2-p3-server.mjs`를
   별도 터미널에서 실행해 A/B 4201/4202 준비를 확인한다.
2. `node tools/w2-p3-run.mjs compare`: A/B/A 각 10 새 process, 각 20 예열,
   각 160회 메모리. 실행 중 다른 GPU 실험을 병렬로 돌리지 않는다.
3. `node tools/w2-p3-run.mjs forced-memory`: B 동일 입력 강제 준비 60회.
4. `node tools/w2-p3-run.mjs untraced-memory`: trace 없는 A/B 각 160회.
5. `node tools/w2-p3-worker-regression.mjs`와
   `node tools/w2-p3-browser-regression.mjs`를 별도 실행한다.
   browser-regression 기본 이름과 포트는 `PANDOLAB_W3_REGRESSION_NAME`,
   `PANDOLAB_W3_REGRESSION_PORT`로 지정한다. 기존 결과 이름이면 거부한다.
6. 최신 회귀는 서버에 `PANDOLAB_W3_LATEST=D:/dev/worktrees/w2-p3-latest`,
   runner에 `PANDOLAB_W3_LATEST_SHA=<fixed sha>`를 지정해 `latest` phase와
   4203 browser-regression을 실행한다. 주 A/B 통계에 합치지 않는다.
7. `node tools/w2-p3-analyze.mjs`, `node tools/w2-p3-export.mjs`로 공통 CDP
   시각을 분석한다. 주 최초 표본에 느린 표본을 모두 포함한다.

주 측정 emitted source는 v2이며 최신 generator v3는 빈 outline 배열의
보조 detach 표기만 수정했다. 원본 v2는 외부 보고서에 그대로 보존했다.
실제 detach 검증은 직접 CDP ArrayBuffer.detached와 내용 비교로 수행했다.
원시 JSON 중 큰 파일은 원래 바이트를 검증한 gzip으로 보관하며,
compression 로그에 원문 SHA-256과 길이를 기록했다.
원격 발행/재검증은 이 보고서 scope만 선택해
`node tools/data/library-data.mjs --check-reports --include-prefix=reports/development/performance/w2-p3-windows-gpu-final-2026-11-02`
로 실행한다. 전체 프로젝트 검사나 GIS 재생성은 필요하지 않다.
