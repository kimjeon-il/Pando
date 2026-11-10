# 판도연구소 성능 진단 지표

지도 렌더링의 P0 기준선 및 P1 동적 LOD 진단 절차는
[지도 렌더링 P0·P1 기록](architecture/map-rendering-lod-p0-p1.md)을 참고한다.

런타임 성능 보고서는 개발자 도구 콘솔에서 다음 명령으로 확인한다.

```js
window.__PANDOLAB_PERFORMANCE_REPORT__()
```

기존 초기 구동 원시 지표는 계속 사용할 수 있다.

```js
window.__PANDOLAB_STARTUP_METRICS__
```

## 보고서 항목

- `startup`: preview, interactive, editable, ready 시점과 데이터 자산별 load/parse 지표
- `browser`: navigation 및 paint timing
- `longTasks`: 전체 long task와 탐색 시작 후 첫 5초 집계
- `eventTimings`: 16ms 이상 걸린 브라우저 Event Timing 항목
- `layoutShifts`: 최근 사용자 입력과 무관한 layout shift
- `memory`: Chromium에서 제공되는 경우의 JS heap 표본
- `operations.mobile-sheet.drag`: 모바일 시트 드래그 시간, 평균/최대 프레임 간격, 느린 프레임과 추정 누락 프레임
- `operations.project.command`: 일반 동기 문서·보기 명령의 총 시간

## 해석 기준

`window.__PANDOLAB_PERFORMANCE_THRESHOLDS__`는 진단용 기준이며 기능을 차단하는 하드 제한이 아니다.
기기와 브라우저가 다른 측정값을 직접 비교하지 말고, 같은 기기·같은 프로젝트·같은 작업을 반복해 전후 차이를 비교한다.

권장 비교 절차:

1. 강력 새로고침 후 첫 실행 보고서를 저장한다.
2. 같은 페이지를 다시 열어 warm-cache 보고서를 저장한다.
3. 모바일 시트를 2~3초간 드래그한다.
4. 보고서를 다시 저장하고 최적화 전후의 `count`, `p95Ms`, `maxMs`, `firstLoadTotalMs`를 비교한다.

보고서는 최근 표본 120개만 유지한다. 프로젝트 데이터나 사용자 입력값 전체를 저장하거나 외부로 전송하지 않는다.

## W1 Windows 실제 GPU 검증 근거

2026-11-02의 W1 측정은 `work/ui` 코드 `69a34dceccdf4b348dfaaab79fa5dc712a169e53`와
라이브러리 runtime pin `5eb7be55208efaafe39bd5a65ec2f111d70b9053`을 사용했다.
보고서, 원시 trace, 로그, 스크린샷 및 재현용 측정 패치는 외부 라이브러리의
`reports/development/performance/w1-windows-gpu-2026-11-02/measurement/README.md`에 있다.
보고서 원격 바이트 검증 revision은 `fd58c91c2bb944e338c026add222788373ba2ffd`다.
이는 해당 호스트와 측정 시점의 근거이며 현재 빌드 전체의 성능 보장을 뜻하지 않는다.
