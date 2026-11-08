# W2-P3 — 공유국경 stroke 패킷 중복 계산 제거

일자: 2026-11-02 · 브랜치: work/ui · 공개 배포: 없음

## 근거 및 범위

W2-P2: https://github.com/kimjeon-il/PandoLab-library-data/blob/b508d8050913e638fee520ad87b0b27b6302af50/reports/development/performance/w2-p2-windows-first-transition-2026-11-02/README.md

Windows GTX 1650 D3D11에서 초기 공유국경 Worker가 첫 연도 이동과 겹칠 때 새 프로젝트 세대의 stroke packet을 중복 조립하는 약 1초 구간이 관찰됐다. W1 원본 추가 2,119ms의 모든 하위 이벤트를 소급 분해하지 못했으므로 W2-P2 엄격 완료 판정은 그대로 미완료다.

## 구현

- 변경 소유자: src/rendering/workers/country-shared-boundary-worker.js. 마지막으로 검증된 패킷 하나를 Worker 내부에 보관.
- 동일성: Worker가 실제 형상에서 계산한 SHA-256 + 순서가 유지된 국가 ID·상위 관계 + 품질·외곽선 표시 상태. 복제된 JS 객체 주소·세대 번호만으로 재사용하지 않음.
- 변경된 형상 또는 새로 적용한 외부 토폴로지 캐시가 있으면 보관본 무효화.
- 패킷 보관 추정량 상한 96 MiB / 1개. 이는 typed-array 바이트와 segment 개수로 산출한 상한 검사용 추정량으로, 전체 JS/GPU 네이티브 메모리 실측이 아님.
- postMessage로 전송되는 여섯 개 TypedArray에 대해 보관본과 다른 ArrayBuffer를 사용. 전송 버퍼가 detach돼도 캐시는 다시 쓸 수 있음.
- 이전 세대의 완성된 immutable 준비도 다음 세대의 입력이 정확히 일치하면 재사용 가능. 기존 requestId·projectGeneration·geometryRevision·quality 검증은 전혀 우회하지 않음.
- Worker 출력 진단 packetCacheHit, packetCacheResidentEstimate, packetPreparationMs 기록.
- C++ Core, GIS 데이터, country boundary 승인 게이트, 렌더링 품질은 불변.

## 실제 회귀 및 성능 근거

- 기존 공유국경 회귀·WebGL 표시: https://github.com/kimjeon-il/Pando/actions/runs/41392419468 — 성공.
- W2-P3 실제 세계 지도 시험: https://github.com/kimjeon-il/Pando/actions/runs/41393566750 — 성공.
- 실제 국가 공유국경 75,205구간: 테스트 전용 동일 입력 재준비에 대한 Worker 패킷 계산 3,298.1ms 대 보관 패킷 전송용 복사 2.5ms.
- 보관 추정량 16,556,996bytes. Linux Chromium CI 조건의 한 쌍이며 Windows GTX 1650의 지도 전환 시간 단축 수치로 간주하지 않음.
- 일반 2025↔2026년 이동에서 메인 renderer의 인증된 준비 국경을 재사용해 Worker를 다시 호출하지 않는 기존 경로를 보존.
- 단위 테스트에서 동일 입력/세대 갱신, 명칭만 변경, 국경 소유 계층 변경, outlines 토글, 미세 좌표 변동, 전송 버퍼 분리를 검사.

## Windows 실GPU 최종 검증 게이트 — 미완료

현재 도구에서 실제 Windows GTX 1650에 직접 접근할 수 없어 냉시동 10회/예열 20회 이상의 W2-P3 전후 성능 비교는 수행하지 못했다. 로컬 Codex가 보존된 W2-P2 측정 환경을 동기화할 때 미커밋 및 복구 산출물과 데이터 핀을 덮어쓰지 않을 것.

측정 절차: 같은 컴퓨터에서 새 browser/context 시작, Chromium 버전/실제 NVIDIA D3D11 unmasked renderer/GPU compositing 확인, 2026-11 ↔ 2025-12 연도 전환 반복, packetCacheHit·packetPreparationMs·요청→표시·요청→ready·최장 Long Task·Worker 메모리 기록, 정확한 국가·국경·지명 해시와 실패/취소/rollback 및 메모리 plateau 확인. 현재 tests/browser/rendering/viewer-gpu-backend-cross.spec.mjs는 Windows D3D11을 명시하고 cold warmup 표본을 따로 보관함.

**구현·기능 회귀 완료 / Windows 실GPU에서 성능 개선 정량 검증 미완료.** W1 원본, W2-P2 기준 소스 및 현 work/ui의 자료 핀과 테스트 빌드를 혼동하거나 서로 다른 CI 지연을 근거로 개선율을 계산하지 말 것.

main 통합, Pages 배포, 라이브러리 런타임 자료 수정 없음.
