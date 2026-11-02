# W2-P2 Windows 최초 연도 전환 진단 재현

측정 대상은 W1 소스 `69a34dceccdf4b348dfaaab79fa5dc712a169e53`이며,
runtime pin은 `5eb7be55208efaafe39bd5a65ec2f111d70b9053`이다.
보고서와 원시 증거는 외부 라이브러리의 다음 범위에 있다.

`reports/development/performance/w2-p2-windows-first-transition-2026-11-02/README.md`

원격 보관 revision: `b508d8050913e638fee520ad87b0b27b6302af50`.
위 선택 범위의 166개 파일을 `--check-reports`로 원격 바이트 재검증한다.

재현된 packet 계산/게시의 인과관계는 확인했지만, 원본 W1 추가 2119ms의
요청별 소급 분해와 장기 메모리/전체 복구 UI 검증은 미확정이다.
엄격한 W2-P2 완료 상태는 보고서의 미완료 판정을 따른다.
최적화 구현은 W2-P3의 별도 작업이다.

## 실행

Windows에서 `D:/dev/worktrees/w2-p2-diagnostic`의 detached W1 checkout을
재사용한다. tracked 소스가 clean이고 HEAD가 위 커밋인지 확인한다.
서버는 ui의 기존 dependencies와 동일 핀의 materialized runtime cache를
사용한다. 제품 파일을 수정하지 않고 테스트 snapshot 응답에 계측한다.

1. `node tools/w2-p2-server.mjs`를 실행하고 4190/4191 준비를 기다린다.
2. `PANDOLAB_W2_EVIDENCE`를 새로운 작업 전용 보고 편집 디렉터리로 지정한다.
3. `node tools/w2-p2-run.mjs baseline`, `control`, `calibration`, `exact`를 순차 실행한다.
4. `node tools/w2-p2-analyze.mjs`로 공통 trace 시각의 단계/CPU profile을 분석한다.

runner는 각 실행의 NVIDIA D3D11/SwiftShader, GPU compositing과 Chromium을
검사한다. 기존 이름의 JSON/PNG/trace가 있으면 덮어쓰지 않는다.
원래 측정 중 단계 계측을 보강했으므로 보고서의 V1~V4 emitted source와
각 표본의 계측 범위를 확인한다. 최신 도구가 V1과 같은 부하라고 가정하지 않는다.

## 검증 범위

공유국경 Worker의 교체/삭제·재사용·상하 관계 및 temporal 취소/stale frame의
집중 회귀 4개를 실행했다. source/geometry/지명 해시, 요청별 gate, 오류와
메모리 원시 표본 및 한계는 외부 보고서에 기록했다.
main 통합과 공개 배포는 포함하지 않는다.
