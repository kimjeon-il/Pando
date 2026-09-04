# 판도연구소 성능 진단 지표

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
- `operations.ui.commit-to-paint`: 주요 편집 확정 명령부터 다음 페인트까지의 시간
- `operations.project.transaction`: geometry/worker 기반 편집 transaction의 총 시간과 단계별 시간
- `operations.project.command`: 일반 동기 문서·보기 명령의 총 시간
- `operations.autosave.persist`: autosave build, IndexedDB, fallback 저장 시간

## 해석 기준

`window.__PANDOLAB_PERFORMANCE_THRESHOLDS__`는 진단용 기준이며 기능을 차단하는 하드 제한이 아니다.
기기와 브라우저가 다른 측정값을 직접 비교하지 말고, 같은 기기·같은 프로젝트·같은 작업을 반복해 전후 차이를 비교한다.

권장 비교 절차:

1. 강력 새로고침 후 첫 실행 보고서를 저장한다.
2. 같은 페이지를 다시 열어 warm-cache 보고서를 저장한다.
3. 모바일 시트를 2~3초간 드래그한다.
4. 대표 편집 작업을 한 번 확정한다.
5. autosave 완료 후 보고서를 다시 저장한다.
6. 최적화 전후의 `count`, `p95Ms`, `maxMs`, `firstLoadTotalMs`를 비교한다.

보고서는 최근 표본 120개만 유지한다. 프로젝트 데이터나 사용자 입력값 전체를 저장하거나 외부로 전송하지 않는다.
