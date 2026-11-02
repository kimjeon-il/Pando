# W2-P5-2 — Windows 실GPU Worker 경합 최종 검토

2026-11-02 (Asia/Seoul). 판정: **제한적 완료. B1 실사용 최적화 채택 금지. B2 합성 Worker 통과, 실제 지도 개선 미확정.**

## 증거

- 제품 기준 소스: fe8282ba32761ab9586348d1712e11cc1f4e7882.
- 데이터: data-f50b7f480c812df6f5ea0c40f5461ab0; 자료 라이브러리 pin 5eb7be55208efaafe39bd5a65ec2f111d70b9053.
- Windows GTX 1650, driver 32.0.16.1088, Chromium 151.0.7922.34, ANGLE D3D11 WebGL2, GPU compositing enabled. 화면 1280×800, 지도 1280×752, DPR1.
- 원시 보고서 및 287개 증거: PandoLab-library-data@a2a22c338c5924a83413e449647f4a9b172100e4 / reports/development/performance/w2-p5-2-windows-gpu-2026-11-02/report.md.
- 실제 W2-P5-2 재현 기록: Pando work/ui@0c589817ebbc11bd5bf9a42debeeeb2a98a44123 / docs/development/w2-p5-2-windows-worker-contention-2026-11-02.md.
- 본 보고서는 GitHub 원본 report.md, comparison.json, baseline-analysis.json, protocol-analysis.json 및 독립 Worker 테스트 코드를 검토한 것으로, 새 GTX 1650 측정을 수행했다는 뜻이 아니다.

## A / B1 / A2 실제 첫 연도 전환

| 지표 | A | B1 same-input join 후보 | A2 |
| --- | ---: | ---: | ---: |
| cold n | 10 | 10 | 10 |
| 표시 p50 | 2172.9ms | 2782.8ms | 2201.0ms |
| 표시 p90 / 최대 | 2245.0 / 2248.2ms | 2878.8 / 2991.0ms | 2365.3 / 2397.5ms |
| 2500ms 초과 | 0/10 | 8/10 | 0/10 |
| warmed p50 (별도 n20) | 797.2ms | 787.0ms | 803.2ms |
| 실제 join 승인 | 0 | 0 | 0 |
| 전환의 별도 Worker 요청 없음 | 4/10 | 2/10 | 4/10 |

B1 cold p50은 A 대비 약 609.9ms(28.1%) 악화됐다. 시도된 full-input SHA join 후보 두 건은 모두 불일치로 native path로 돌아가 **실제 재사용 이익 0건**. 전체 serialized input hash가 달랐다는 사실이 기존 Worker의 국경 패킷 identity도 달랐다는 뜻은 아니다. B1 추가 직렬화 대상의 어떤 필드가 다른지는 아직 확인되지 않았다.

B1은 약 13,308,618 bytes 전체 객체를 메인에서 structuredClone(434.9–472.7ms)한 뒤 JSON/UTF-8 직렬화(140.7–144.8ms)했다. 이 두 추가 호출은 표본당 대략 575–617ms이며 최대 Long Task를 A 391ms에서 B1 1037ms까지 높인 유력 원인이다. 다만 end-to-end p50 악화에 대한 정확한 개별 인과 기여율은 단독 통제되지 않았다.

## Worker 큐 경합 재현 여부

기존 A의 실제 전환 중 Worker 요청이 있었던 6개 표본에서는 이전 계산과 동시 겹침 0/6, post 반환부터 Worker listener 이전 대기 p50 0.052ms(최대 0.121ms). A2도 실제 요청 6개에서 listener 대기 p50 0.048ms. 따라서 **이번 기본 256KiB 실측은 W2-P4-2의 특수 1MiB 집단에서 관측된 약 817ms 대기를 재현하지 않았다**. 특수 상황의 Worker 경합 자체가 허위라는 의미는 아니며, 1MiB 상향을 그 원인으로 확정하는 근거도 아니다.

## B2 합성 변경 입력: 통제된 계산 전 취소

실제 Viewer를 바꾸지 않고 별도 Worker에서 국가 boundaryRootId를 변경했다. 동일한 계산 진입 전 checkpoint에서 오래된 요청을 취소했다.

| A | B2 | A2 |
| ---: | ---: | ---: |
| 7526.1ms | 4101.4ms | 7571.8ms |

각 조건 n10, 독립 packet metadata와 TypedArray SHA 30/30 일치. 약 45.5% 절감은 **합성 Worker에서만** 유효하다. 실제 국경이 달라지는 자연 연도 전환의 시간 개선, 초기 지도 패킷의 불필요 여부, 이미 실행 중인 동기 네이티브 코드의 선점은 입증되지 않았다.

## 정확성 및 미완료

- 실제 전환의 국가·형상·귀속·지명·좌표·timeline 상태 SHA가 A/B1/A2에서 일치. 대표 스크린샷은 정상 표시되나 전 픽셀 전수 동일성 검증은 하지 않았다.
- 오래된 request ID, 세대, geometry revision, quality 응답 각각 거부. Worker 오류 후 reload 및 WebGL context loss/recovery 통과.
- **전환 중 Worker 오류 rollback 테스트는 2회 모두 주입 응답을 관측하지 못해 미검증이다.** 이 항목을 정상으로 처리하거나 실GPU 최종 안전성 완료를 선언하면 안 된다. 테스트의 진단 마커 선택 오류도 보고서에 남아 있다.
- 빠른 연속 취소 및 입력 반응성은 미측정.
- 20회 메모리·GC후 Worker heap 거의 일정; retained packet 약 16.56MB / 96MiB, 분리된 보관 배열 없음. 장기 메모리 누수 부재는 증명하지 않았다.
- 별도 worktree-storage.mjs GIS cache retirement 프로세스의 CPU/디스크 간섭 가능성이 관측되었다. 측정은 순차적·비무작위였으며 특정 단계의 개선율을 전체 사용자 환경으로 일반화하지 않는다.

## 결정 및 우선순위

**W2-P5-2는 제한적 완료로 종료. B1 코드의 제품 반영을 보류한다. B2는 합성 통제 결과만 보존한다.**

다음 과제는 **W2-P6: 실제 Viewer 국가 스냅샷 전달 비용 축소**를 중심으로 설계·원인 측정부터 시작하는 것을 제안한다.

- W2-P4-2 기본 경로에서 Worker 입력 postMessage 동기 구간 약 208–224ms, Worker의 첫 event.data 복원 구간 약 236–249ms가 반복 관측됐다. B1의 새로 추가된 575–617ms를 기존 제품 전달 비용과 동일시하지 않는다.
- 가장 먼저 기존 입력의 정확한 바이트·객체·TypedArray 수, Worker 내부에서 이미 검증된 geometry digest/owner/root/quality/outline 및 캐시 수명을 확인한다. 이전 세대의 shape 참조, delta, binary 등의 대안은 매 새 세대의 exact identity 및 stale/cancel/rollback/초기화 안전성 증명 후에만 통제한다.
- 별도 UTF-8 transferable fixture의 930ms→532ms 왕복 결과는 실제 지도 경로의 개선으로 주장하지 않는다. 인코딩·복원 비용, JS heap, Long Task, 메모리/transfer detach, 실제 지도 표시 p50/p90/최대/2500ms 초과 수를 모두 측정한다.
- 구현 전 안전성 게이트: 전환 중 Worker 오류 롤백 주입·기존 화면 보존·데이터/cursor 복구 검증을 성공시키고, 실제 입력을 변경한 연속 전환에서 stale-result 거부를 검증한다.
- 다음 A-B-A는 고정 소스·동일 data pin·실 GTX1650 D3D11, 첫 전환 각 cold n>=10, warm n>=20, GC/trace 부하 분리. 데이터·국경·지명 및 의미 SHA, 대표 화면 픽셀, 성능·입력 반응성·메모리 동시 측정. 실제 전환 개선이 없으면 제품 적용 금지.
- 우회 금지: temporalFrameReady, requestId, projectGeneration, geometryRevision, quality, buffer lifetime, rollback, WebGL 복구. 1MiB upload 예산 상향도 동시 변경하지 않는다.

이 기록은 문서 추가만 포함하며 기존 W2-P5-2 원시 자료, 미커밋 docs/branch-policy.md, detached 측정 worktree, WASM/manifest, GIS 데이터, main 및 배포를 변경하지 않는다.
