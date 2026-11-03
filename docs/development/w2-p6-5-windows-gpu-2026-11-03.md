# W2-P6-5 Windows 실GPU 형상 델타 검증

판정은 **제한적 완료**다. NVIDIA GTX 1650 / D3D11에서 1992→1991년 실제 국가 변경 전환의 지도 표시 p50은 A 5371.1ms, P6-3 B 5126.8ms, A2 5354.8ms였다. B는 10/10회 delta로 242개 중 241개 형상을 생략하고 삭제 ID 4개를 전달했다. 같은 표본에서 전체 표시는 약 4.3~4.5% 짧았으나 여전히 5초를 넘었다. 반대 1991→1992는 B도 10/10회 전체 전송이었다. 2026→2025 최초 전환의 B 10회에는 새 Worker 요청이 없어 그 경로의 델타 효과는 미입증이다.

완료 전환의 날짜별 국가·형상·관계·지명·timeline 해시는 A/B/A2에서 같았다. 실제 Worker 오류를 주입한 전환은 이전 데이터와 캔버스 픽셀을 보존하고 재시도에 성공했다. B의 60회 강제 재준비는 모두 delta였고 60회 범위의 GC 후 Worker heap과 보유 패킷은 안정적이었다. WebGL 복원 직후 해시 불일치 첫 시도와 안정화 후 성공한 재시험을 모두 보존했다.

정확한 조건, 전체 결과, 한계 및 원본은 PandoLab-library-data 커밋 `5d245b038eb2009c5a44cf8af6a1d18cd21f4d66`의 `reports/development/performance/w2-p6-5-windows-gpu-2026-11-03/report.md`를 참조한다. 선택 범위 352개 파일은 `--publish-reports`로 저장하고 `--check-reports`로 원격 바이트를 재검증했다. B 구현을 `work/ui`에 통합하지 않았으며 main 병합·배포도 수행하지 않았다.

## 재현

두 고정 커밋 `ee6efddb7335a6665647cc69951e40103830c3e8`, `0af8b63d2efbeb19e9b677ec23d5f3fb92abfb83`의 Git 객체와 데이터 캐시 revision `5eb7be55208efaafe39bd5a65ec2f111d70b9053`을 준비한다. `PANDOLAB_W3_EVIDENCE`는 반드시 새 빈 범위로 지정한다. 기존 파일이 있으면 진단 프로그램은 덮어쓰지 않고 중단한다. 첫 화면의 현재 월은 2026-11이어야 한다.

별도 터미널 두 개에서 같은 증거 경로를 설정하고 각각 아래 서버를 실행한다.

```powershell
$env:PANDOLAB_W3_EVIDENCE = 'D:/dev/PandoLab-library-data/reports/.edits/ui/development/performance/<new-scope>'
$env:W65_SOURCE = 'ee6efddb7335a6665647cc69951e40103830c3e8'; $env:W65_PORT = '4261'
node tools/w2-p6-5-server.mjs
# 다른 터미널: W65_SOURCE=0af8b63d2efbeb19e9b677ec23d5f3fb92abfb83, W65_PORT=4262
# node tools/w2-p6-5-server.mjs
```

측정 터미널에서 같은 증거 경로를 지정하고 `W65_ARM=A`, `B`, `A2`를 차례로 설정한다. A/A2에는 포트 4261과 A SHA, B에는 포트 4262와 B SHA를 지정한 뒤 `node tools/w2-p6-5-run.mjs`를 순차 실행한다. 실제 변경 연도는 `node tools/w2-p6-5-historical.mjs`를 같은 순서로 실행한다. 기본은 각 조건 3회이며 나머지 7회는 `W65_START=3`, `W65_COUNT=10`으로 반복한다. 추가 input·force·memory·diagnostic·stale·webgl 절차와 원본 테스트는 라이브러리 보고서에 있다. 측정과 trace 분석을 동시에 실행하지 않는다.
