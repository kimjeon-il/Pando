# OBJ-087 — 현행 main 동일 소스 1989년 소련 시점 왕복 12회 장기 메모리 검증

> 보고서 ID: OBJ-087 · 상태: verified-web-diagnostics · 지도 반영: not-applicable · 색인일: 2026-10-17  
> 원문 최종 수정: 2026-10-17 · 제품 기준: main **e85b3e158d5c02e4aa028283db5b83a1750f4b1a**  
> 대상: WebGL2/Chromium 1440×900, 1989-06 소련 ↔ 현대 2026-10 **12회 왕복 × 3회 실행**. Qt 앱·Windows WebView2·Android 실기기 제외  
> 실측 실행: [① 성공 #38988743997](https://github.com/kimjeon-il/Pando/actions/runs/38988743997) · [② 12회 완료/진단 단언 실패 #38989499065](https://github.com/kimjeon-il/Pando/actions/runs/38989499065) · [③ 최종 성공 #38990251532](https://github.com/kimjeon-il/Pando/actions/runs/38990251532)  
> 원시 JSON: [① artifact 12083743891](https://github.com/kimjeon-il/Pando/actions/runs/38988743997/artifacts/12083743891) · [② artifact 12084732717](https://github.com/kimjeon-il/Pando/actions/runs/38989499065/artifacts/12084732717) · [③ artifact 12084912621](https://github.com/kimjeon-il/Pando/actions/runs/38990251532/artifacts/12084912621) (GitHub Actions 보관기한 적용)

## 검증 대상과 기준

현재 main과 동일한 제품 커밋 e85b3e1에서 출발한 기존 통합 브랜치 work/integration-ui-objects-20261016에 **테스트·계측 헬퍼·CI 워크플로만** 추가했다. CI는 기준 main 커밋에서 검사 커밋까지 테스트 경로 외 변경이 없음을 확인했다. main 직접 수정·병합·Pages 배포는 없다.

각 실행에서 1989-06 소련 선택 → 원래 현대 월로 이동을 12회 반복하고, 초기 상태 + 소련 12회 + 현대 복귀 12회 + 마지막 추가 30초 유휴의 **총 26개 스냅샷**을 보존했다. 현대 복귀는 6초 이상 무입력·CDP 메인/Worker별 GC 뒤 측정했다. 최초 냉시작 상태(modern-0)는 반복 후 비교의 기준선에서 제외한다. 객체 편집은 수행하지 않았다.

메인/Worker JS는 각 CDP Runtime.getHeapUsage, WASM은 살아 있는 WebAssembly.Memory의 buffer.byteLength 추적, 프로세스 메모리는 Linux /proc/smaps_rollup의 **Chromium PSS** 합계다. WASM 선형 버퍼 크기는 C++ 실제 사용 힙이 아니며 PSS는 개별 Worker, 드라이버 물리 VRAM으로 나눌 수 없다. GPU Stroke 계수도 VRAM 총량을 뜻하지 않는다.

두 번째 실행에서는 현대 1·3회차에 UI의 경계 교체 pending 플래그가 **샘플 수집 도중 다시 참**이 됐다. 별도 Worker 측정에서 대기 및 실행은 모두 거짓이었다. 그 실행은 12회 작업과 원시 자료 보존을 마쳤지만 **모든 샘플이 pending=false여야 한다는 과도한 테스트 단언** 때문에 실패했다. 최종 검증은 해당 표본을 유휴 중앙값에서 제외하고, 마지막 진정 유휴·계측 완전성을 별도 검사하도록 보완해 통과했다.

## 장기 수렴성 결과

아래 앞4/뒤4 중앙값은 각 실행의 **대기 없는 동일한 현대 복귀 상태**를 기준으로 한다. 실행 간 메모리 절대값은 CI 프로세스 조건·Worker 구성 차이로 직접 비교하지 않는다.

| 실행 | 유효 현대 표본 | Chromium PSS 앞4→뒤4 (MiB) | Worker JS 앞4→뒤4 (MiB) | Worker WASM (MiB) | 마지막 추가 30초 PSS 감소 |
| --- | ---: | --- | --- | ---: | ---: |
| ① 첫 통과 | 12/12 | 2148.53→2168.21 (+19.68) | 371.00→371.10 (+0.10) | 387.50 유지 | −177.83 MiB |
| ② 중간 진단 | 10/12 | 2173.35→2179.84 (+6.49) | 370.97→371.53 (+0.56) | 387.50 유지 | −181.30 MiB |
| ③ 최종 통과 | 12/12 | 2061.96→2108.65 (+46.69) | 447.62→447.69 (+0.07) | 403.50 유지 | −52.91 MiB |

모든 실행에서 12회 왕복 완료, 브라우저 오류 0, 프로젝트 전체 자동저장 **0회**, 미리보기 Worker 생성 **0회**, Worker JS/WASM 측정 완전, 소련 형상 문자열 길이 892,231·FNV32 해시 3651925410 시작/마지막 동일이었다.

후반 현대 복귀 9~12회 PSS 범위는 ① 2166.94~2169.74MiB, ② 2173.80~2184.46MiB, ③ 2107.33~2110.96MiB이다. 회차 5~12의 PSS 기울기는 ① −0.04MiB/회, ② −0.81MiB/회로 계속 증가하지 않았다. ③도 7회 이후 2107~2111MiB 안팎에서 안정됐다. **측정한 12회에서는 단조 증가 메모리 누수 증거가 없다**. 임의의 훨씬 긴 실행·Windows 실사용 환경에서 누수 부재를 증명한 것은 아니다.

## 상주 Worker 메모리와 조건별 차이

①·②는 상주 Worker 6개, 공유 국경선 Worker JS 약 360MiB, Worker JS 합계 약 371MiB, Worker WASM 선형 버퍼 387.5MiB였다. Map-edit Worker는 일시적으로 생성되고 종료됐다.

③은 상주 Worker가 **7개**였다. 편집하지 않았지만 Map-edit Worker 하나가 남아 JS 약 43.8MiB, WASM 16MiB를 유지했다. 이 실행에서 공유 국경선 Worker JS는 반복 복귀 중 약 393.0MiB, 전체 Worker JS 약 447.7MiB, Worker WASM 403.5MiB였지만 추가 30초 유휴 후 국경선 Worker JS는 **약 360.1MiB**로 하락했다. Worker 수명과 지연 해제에 따른 기준선 차이로 보이며, 반복에 따라 메모리가 계속 누적된 현상은 아니다. 다만 6개/7개 구성 차이의 구체적인 수명 원인은 아직 확정하지 않았다.

공유 국경선 Worker의 WASM은 처음 현대를 로드할 때 약 16→57.63MiB로 확장한 뒤 세 실행에서 더 증가하지 않았다. 현대 국가 입력 254개, 접촉 결과 339건으로 일정하며, 현대 복귀 후 국경선 Worker의 queued=false·draining=false가 관측됐다. JS 기본 보유량 약 360MiB가 반드시 필요한지는 retained-object graph 검증이 필요하다.

## 누수와 다른 CPU/GPU 재계산 비효율

- 공유 국경선 Worker의 preparationCount가 동일한 현대 복귀 때마다 **+259**, contactComputationCount가 **+1,176** 증가했다. 12회차 누적치는 3,362 / 14,112회이며 최종 접촉 결과는 계속 339건이다. 이는 **같은 현대 형상 준비 재계산**이 반복됨을 뜻하며 누수와 별도 최적화 문제다.
- GPU Stroke 추적 버퍼는 현대 첫 복귀 약 19.79MiB → 후반 41.32MiB로 커진 뒤 유지됐다. 마지막 추적 자원 예산은 약 36.48MiB, 초과량 약 4.84MiB, 누적 자원 축출 23회였다. 이후에도 왕복 시 축출 횟수가 늘어나는 GPU 자원 churn을 조사해야 한다. 추적 버퍼 계수는 VRAM 총량이 아니다.
- 30초 유휴 후 전체 PSS는 세 실행 모두 감소했다. ①·②에서는 대부분 Chromium 렌더러 PSS 반환에 해당했고, ③에는 공유 국경선 Worker JS 감소 약 33MiB도 동반됐다. JS heap snapshot·V8 retaining graph·OS allocator 사용량 분석 없이 이를 단일 코드 누수에 귀속하지 않는다.

## 판정 및 다음 조사

**결론:** 현행 main 제품에서 소련 ↔ 현대 12회 반복 전환은 메인/Worker/WASM 메모리 사용량이 초기에 확장 후 안정되고, PSS도 마지막 구간에서 수렴한다. 과거 work/objects의 미리보기 60초 제한시간 문제는 현행 main의 월 이동 경로에서는 발생하지 않았다.

미해결 후속 과제는 (1) 국경선 Worker의 360MiB 보유 객체 실제 retained size와 일시적 393→360MiB 해제 경로, (2) 편집하지 않았는데 Map-edit Worker가 남는 6/7개 생명주기 차이, (3) 같은 현대 세계의 경계 준비 및 접촉 계산 반복, (4) GPU Stroke 축출·재업로드 수명, (5) Windows WebView2 및 물리 GPU 교차 검증이다. Android 실기기는 현 단계에서 제외한다.

## 변경 및 증거 보존

통합 브랜치의 테스트 전용 커밋은 [a674594f](https://github.com/kimjeon-il/Pando/commit/a674594f82d8f8d0f0b4913cde06315926b58e83), [246024a4](https://github.com/kimjeon-il/Pando/commit/246024a4037425b5494b6f1bf1a7513dc17dbf5e), [6ad21326](https://github.com/kimjeon-il/Pando/commit/6ad2132636a7b545891b137c0814612210a561a4), [834bd312](https://github.com/kimjeon-il/Pando/commit/834bd3120857a38526108bbaa144988aff63c95b)이며 **제품 소스·자산 변경은 없다**. 본 보고서와 색인만 work/objects에 저장한다. 이전 [OBJ-084](soviet-memory-retention-roundtrip-2026-10-17.md)·[OBJ-085](soviet-preview-build-attribution-2026-10-17.md)는 당시 분기 기준 자료로 보존한다.
