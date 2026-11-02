# W2-P5-2 Windows GPU 공유국경 경합 검증

판정은 **제한적 완료**다. 동일 입력 결합 진단 후보는 실제 전환 10회 중 결합 0회였고 최초 표시 중앙값은 기준 A 2172.9ms, B1 2782.8ms, A2 2201.0ms였다. B1의 실사용 개선은 확인되지 않았으며 적용을 보류한다. 변경 입력의 별도 합성 Worker 실험에서 계산 진입 전 취소 효과가 관찰됐으나 실제 지도 전환 효과로 해석할 수 없다. 전환 중 Worker 오류 롤백, 초기 패킷의 필수 여부, 실제 변경 입력 지도 전환은 미확정이다.

실측 원본과 보고서는 라이브러리 저장소의 `reports/development/performance/w2-p5-2-windows-gpu-2026-11-02/report.md`에 있다. 선택 범위 287개 파일은 라이브러리 커밋 `a2a22c338c5924a83413e449647f4a9b172100e4`에 발행했고 `--check-reports`로 같은 커밋의 원격 바이트를 확인했다. 원시 JSON·CDP trace·화면·진단 snapshot·로그·해시 및 분석 소스가 함께 보관된다.

측정은 `fe8282ba32761ab9586348d1712e11cc1f4e7882`, 데이터 핀 `5eb7be55208efaafe39bd5a65ec2f111d70b9053`, runtime `data-f50b7f480c812df6f5ea0c40f5461ab0`에서 GTX 1650 / NVIDIA 32.0.16.1088 / Chromium 151.0.7922.34 / WebGL2 ANGLE D3D11 / GPU compositing / 256KiB step을 확인하고 수행했다. 새 Chromium 프로세스를 첫 전환마다 사용했으며 OS 파일 캐시 제거는 하지 않았다.

## 재현

기존 `D:/dev/worktrees/w2-p3-after`와 고정 데이터 캐시를 보존하고 사용한다. 아래 경로는 새 빈 결과 디렉터리여야 한다. 실행기는 기존 결과를 덮어쓰지 않는다. 전환 계측과 trace 분석을 동시에 실행하지 않는다.

```powershell
$env:PANDOLAB_W3_EVIDENCE = 'D:/dev/PandoLab-library-data/reports/.edits/ui/development/performance/<new-scope>'
node tools/w2-p5-2-server.mjs
# 다른 터미널에서 같은 환경 변수를 지정한 뒤:
node tools/w2-p5-2-run.mjs baseline
# 별도 터미널에서 동일한 환경 변수로 서버를 시작:
node tools/w2-p5-2-join-server.mjs
# 측정은 순차 실행:
node tools/w2-p5-2-run.mjs join
node tools/w2-p5-2-run.mjs baseline-retest
node tools/w2-p5-2-compare.mjs
```

변경 입력 실험은 baseline 서버만 동작할 때 `$env:W5_PROTOCOL_SCENARIOS = 'changed'`를 지정하고 `node tools/w2-p5-2-protocol.mjs`를 실행한다. 이는 별도 합성 Worker의 통제 실험이다. 초기 화면, 메모리, 오류 주입, 단위 검사와 한계에 관한 정확한 방법은 보관 보고서를 참조한다. 제품 코드, GIS 데이터와 표시 승인 조건은 바꾸지 않았고 main 병합이나 배포는 하지 않았다.
