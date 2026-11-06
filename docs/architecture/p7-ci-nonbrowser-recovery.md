# P7 비브라우저 CI 복구 기록 — 2026-11-06

## 진단

- PR #1의 Application checks (run 42177398425)는 `country-lineage-preservation.test.mjs`에서 새 자료 핀 `3673ce501c5c2479356414816b5c5daa0ca3e6c6`과 이전 원본 검토표의 `reviewedRuntimeRevision=30ce140bdd55b45cbe40d75346719a4b140e1342` 불일치로 실패했다. 검사는 원본 바이트의 해시 대조 전에 중단됐다.
- P2 (run 42177215169)는 source `60e5abdba00bb5a7809531a94d5a0a8cd5a1baeb`가 실행되는 동안 원격 `work/objects`가 `d9ec387069026fc92c629b4f0011c5d67fac9b89`로 앞서 가면서 `P2_REMOTE_BRANCH_CHANGED`에 걸렸다. 원격 쓰기 차단은 올바른 동작이었다.

## 원본 검토

`kimjeon-il/PandoLab-library-data`의 두 정확한 핀 `30ce140...`과 `3673ce...`에서 `archive/index.json` 전체를 각각 읽고, `assets/data/territorial-entities/source/` 이하 554개 항목을 비교했다. 모든 항목의 경로·저장 Blob·인코딩·SHA-256·바이트 길이가 동일했다. 국가 286개·계보 265개(원본 551개)의 과거 해시 검토표를 그대로 보존하고, 새 핀의 승계 근거만 `runtimePinReview`에 기록했다. 기하 버전 수는 기존 검토표의 313개이며 테스트 제목의 315개는 오기였다.

이 비교는 해당 원본 파일에만 한정된다. 다른 생성 지도 자산 전체의 동일성을 보증하지 않으며, 원본 파일 551개의 실제 SHA-256 검사는 계속 실행한다. C++/WASM·라이브러리 데이터 내용과 핀 자체는 변경하지 않는다.

## P2 개선

`assertBranchState`의 원격 SHA 일치 검사, 비강제 푸시, 생성 산출물 무결성 검사를 유지했다. CI 어댑터에서 정확히 `P2_REMOTE_BRANCH_CHANGED` 예외만 처리하고, 실제 원격 HEAD가 실행 원본 SHA의 후손인 경우에만 `superseded=true`로 종료한다. 해당 실행은 결과 게시, 후속 P3, 산출물 업로드를 하지 않는다. 강제 재작성·원격 누락·다른 오류는 실패한다. 빠른 전진과 재작성 사례의 테스트를 각각 추가했다.

## 후속 확인

- `node --test tests/unit/country-lineage-preservation.test.mjs tests/unit/p2-artifact-plan.test.mjs tests/unit/p2-publication-paths.test.mjs`
- 이 커밋에 대한 Application checks 비브라우저 전체 통과와 P2 계획/게시 실행 결과 확인
- 브라우저 실패·DEM·LOD·GPKG는 별도 단계로 남긴다. main 병합·배포는 하지 않는다.
