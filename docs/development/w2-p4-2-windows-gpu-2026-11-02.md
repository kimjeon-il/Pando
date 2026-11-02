# W2-P4-2 Windows GTX 1650 실GPU 인과관계 검증

측정일: 2026-11-02. 제품 최적화와 GIS 변경은 없다.

원문·원시 JSON·Chromium trace·PNG·검사 로그와 계측 소스:
`reports/development/performance/w2-p4-2-windows-gpu-2026-11-02/README.md`.
자료 저장소: `kimjeon-il/PandoLab-library-data`; 보고서 보관 revision:
`3e63d665f70972902a68008e0d14ec26a2506bad`.
선택 범위 308개 파일을 발행하고 원격 바이트를 별도로 재검증했다.

GTX 1650 드라이버 32.0.16.1088, Chromium 151.0.7922.34,
WebGL2 ANGLE D3D11과 GPU compositing enabled를 매 실행 확인했다.
고정 소스는 `fe8282ba32761ab9586348d1712e11cc1f4e7882`, 데이터 핀은
`5eb7be55208efaafe39bd5a65ec2f111d70b9053`이다.

| 실험 step 상한 | 첫 표시 p50 | p90 | 최대 | 2.5초 초과 |
| --- | ---: | ---: | ---: | ---: |
| A 256KiB | 2198.9ms | 2468.4ms | 2805.4ms | 1/10 |
| B 1MiB | 2813.4ms | 3284.6ms | 3776.9ms | 8/10 |
| A 재시험 256KiB | 2230.3ms | 2447.6ms | 2451.4ms | 0/10 |

실제 Worker cache hit 표본에서 동일한 5,426,656바이트의 국경 업로드는
23→7→23 프레임, 수신→게시 p50은 375.7→112.0→378.1ms였다.
그러나 B의 8개 cache hit 모두에서 이전 패킷의 동기 준비가 같은 Worker
스레드에 겹쳐 새 요청 수신 전 대기 p50 817.0ms 중 약 816.7ms를 차지했다.
이 통제에서 업로드는 단축됐지만 최초 전환 전체는 개선되지 않았다.
측정 중 A/B 일부에 중간 trace 분석이 겹친 부하 가능성도 기록했다.

Worker의 첫 `event.data` 접근은 cache hit 표본 p50 243.3/249.1/235.8ms,
main 측은 60.2/57.5/57.9ms였다. event.data 접근 전후 계측과 필드 읽기를
포함한 wall 구간이다. GPU device의 실제 실행시간은 측정하지 않았다.
대표 화면 픽셀 차이는 0이고 주 전환 120회의 날짜별 데이터 해시는 일치했다.
별도 전송·입력·메모리·취소/rollback·Worker 오류·WebGL 복구 결과와 한계는
원문에 있다. 최종 최적화 대상 결정은 W2-P4-3 범위다.

## 재현

기존 `D:/dev/worktrees/w2-p3-after`의 HEAD와 tracked clean 상태를 확인하고
고정 데이터 캐시 및 ui 의존성을 사용한다. 기존 보고서를 덮어쓰지 않도록
`PANDOLAB_W3_EVIDENCE`를 신규 report scope의 owner 편집 경로로 지정한다.
기존 서버·브라우저 및 GPU 부하를 확인하고 다음을 순차 실행한다.

1. `PANDOLAB_W4_VERSION=v2`로 `node tools/w2-p4-2-server.mjs`를 별도
   터미널에서 실행해 4211/4212/4213 준비를 확인한다.
2. `node tools/w2-p4-2-run.mjs compare`로 10+10+10 콜드, 조건별 예열 20회,
   조건별 trace 없는 콜드 3회를 실행한다. 각 실행은 별도 Chromium process다.
3. `node tools/w2-p4-2-run.mjs memory`, `node tools/w2-p4-2-transport.mjs`,
   `node tools/w2-p4-2-input.mjs`를 순차 실행한다.
4. `PANDOLAB_W3_REGRESSION_PORT=4212`,
   `PANDOLAB_W3_REGRESSION_NAME=p4-B-browser-regression`을 지정하고
   `node tools/w2-p3-browser-regression.mjs`로 오류·WebGL 복구를 검사한다.
5. 서버를 종료하고 `PANDOLAB_W4_VERSION=v3`으로 다시 실행한 뒤
   `node tools/w2-p4-2-run.mjs early`로 초기 준비를 별도 3회 계측한다.
   서버 종료 후 해당 Core rollback·Worker coalescing·temporal 취소 관련
   기존 집중 unit 검사 4개를 실행한다.
6. `node tools/w2-p4-2-analyze.mjs`, `node tools/w2-p4-2-early-analysis.mjs`,
   `node tools/w2-p4-2-pixels.mjs`, `node tools/w2-p4-2-check-snapshot.mjs`,
   `node tools/w2-p4-2-report.mjs`, `node tools/w2-p4-2-audit.mjs` 순으로
   집계한다. 원문에 사용한 emitted source와 진단 script도 함께 보관한다.

완료된 선택 범위는 `node tools/library-data.mjs --publish-reports
--include-prefix=reports/development/performance/w2-p4-2-windows-gpu-2026-11-02`로
보관하고 `--check-reports`로 별도 원격 바이트 확인한다. 다른 작업자의 잠금을
제거하지 않고 실패 상태와 원문을 보존한다. main 통합·배포는 포함하지 않는다.
