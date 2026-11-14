# 핵심 검사 실행

검사와 유지 기준은 [검증 정책](../policies/validation.md)에 있다. [등록 계약](../../scripts/contracts/application-checks.json)은 현재 실행 명령만 선언하고, [실행기](../../scripts/run-application-checks.mjs)는 선택한 명령을 실행해 실패나 차단 즉시 비정상 종료한다. 별도 영향 선택기·분류표·전제 조건 실행기를 두지 않는다.

- `pnpm test:node`: 작은 Node 동작 시나리오. 개별 선택은 `node scripts/run-application-checks.mjs --group=node --test-name-pattern=이름`.
- `pnpm test:browser`: 실제 Viewer 브라우저 흐름. 설치된 브라우저는 Playwright의 channel 또는 executable 환경 설정을 사용한다.
- `pnpm lint`: 문법·정의되지 않은 식별자 등 실행 실패에 직결되는 JavaScript 오류.

CI의 `application-architecture.yml`은 같은 등록에서 명시적으로 선택한 그룹만 실행한다. 빌드·게시 workflow는 실제 생성과 전후 무결성 검증을 소유하며 폐기한 별도 검사 목록을 실행하지 않는다. 원문·자료 pin·외부 소비자가 사용하는 공용 입력은 검사 축소를 이유로 삭제하지 않는다.
