# 핵심 동작 검증

검사 등록은 [application-checks.json](../../scripts/contracts/application-checks.json), 실행은 [run-application-checks.mjs](../../scripts/run-application-checks.mjs)이 소유한다. Node는 현재 구현을 직접 호출해 자료·프로젝트·Worker·원본 보존을 검증하고, Playwright는 실제 Viewer 사용자 흐름을 검증한다. 치명적인 JavaScript 오류는 lint가 맡는다. 같은 결함을 unit·native·WASM·browser에서 반복 검사하지 않는다.

새 검사는 Viewer 실사용 또는 자료 준비·게시·파일 보존의 어떤 중대한 결함을 막는지 설명할 수 있을 때만 추가한다. 함수명·파일 배치·소스 문자열·사소한 외형을 고정하지 않는다. 독립 fixture와 확정 요구사항에서 기대값을 정하며 현재 함수의 출력을 정답으로 복제하지 않는다. 검사 수는 통과 조건이 아니다. 기능을 삭제하면 전용 검사·fixture·helper·등록도 함께 제거한다.

변경에 필요한 최소 시나리오만 선택한다. Node는 실행기의 `--test-name-pattern`으로 한정할 수 있다. 전체 검증은 사용자가 해당 범위를 명시했을 때만 실행한다. 실패·차단·미실행을 성공으로 처리하지 않는다. 필요한 WASM은 source·ABI·컴파일러·파일 해시가 맞는 CI 산출물 하나를 사용하며 로컬 도구를 설치하지 않는다.

실제 생성·저장·게시 경로는 원문 해시·자료 revision·writer 잠금·중간 실패 원자성·원격 경합 거부를 유지한다. Pages는 [게시 전 식별값 검증](../../tools/checks/verify-pages-identity.mjs)과 [게시 후 실제 바이트 검증](../../tools/checks/verify-pages-deployment.mjs)을 수행한다. 자료 고유의 검증은 변경한 입력과 필요한 의존성만 다룬다. 별도 라이브러리의 도구 검사를 이 저장소의 검사 목록으로 복제하지 않는다.
