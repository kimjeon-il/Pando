# 개발·운영 정책

에이전트의 작업 권한·보존·검증 제한은 [AGENTS.md](../../AGENTS.md)가 소유한다. 이 문서는 상설 브랜치, 소스·생성물의 운영 경계와 릴리스의 일반 정책 정본이다.

## 브랜치와 작업공간

- main은 검증·승인된 통합본이며 공개 Pages의 코드 기준이다. work/ui·work/objects·work/gis·work/places는 분야별 상설 작업 브랜치다. 예외 브랜치는 승인된 범위를 따른다.
- 작업 전 worktree 목록·브랜치·원격 앞뒤 관계·추적 및 미추적 변경을 확인하고 기존 상설 작업트리를 재사용한다. 작업마다 clone·브랜치·worktree·빌드 폴더를 새로 만들지 않는다.
- 최신 main을 작업 브랜치에 반영할 때 고유 제품 변경·자료 pin·미완성 작업을 검토하고 보존한다. 자동 stash·reset·clean·강제 checkout·강제 push는 사용하지 않는다. 충돌을 임의로 한쪽 선택해 덮어쓰지 않는다.
- 작업 브랜치의 main 통합·다른 범주 전파·배포에는 해당 범위의 사용자 지시가 필요하다. 상설 브랜치·작업트리 제거는 별도 승인 대상이다.

## 제품과 소스 소유권

Web Viewer와 내장 읽기 전용 점검 UI가 제품이다. 폐기된 편집기·Windows·Android 앱을 개발이나 검증의 전제로 복구하지 않는다.

- src/app은 진입점·조합·시작 수명, src/ui는 UI, src/document는 Core 문서·시간 의미, src/data는 자료·파일 읽기, src/map은 카메라·입력·피킹, src/geometry는 기하 계산, src/rendering은 표시, src/runtime은 Worker·플랫폼·실행 문맥을 소유한다. 제품 C++ 구현은 각 분야 native 디렉터리, 빌드 조정은 tools/build/native에 둔다.
- assets는 정적 릴리스 입력, scripts는 개발·빌드·CI 조정, tools는 유지되는 생성·저장 지원, tests는 핵심 시나리오와 필요한 공용 입력, config는 실행 구성, docs/policies는 정책 정본이다. 자료 마운트는 코드 소유 디렉터리가 아니다.
- 원본 경로와 공개 URL은 [frontend layout](../../scripts/lib/frontend-layout.mjs)이 구분한다. 소스 이동 시 static/dynamic import·classic Worker·자산 수집·CI 소비자를 함께 전환한다. Pages에는 선택된 Viewer 의존 closure만 발행하고 비공개 자료·도구·원본 GIS를 넣지 않는다.
- 라이브러리의 자료·비 Viewer 작성·QGIS·저장소 이력 도구와 Map Toolkit의 분석·학습·배포는 각각 독립 소유자다. 공용 계산을 복사하거나 퇴역 앱 경로를 복원하지 않는다.

## 도구와 생성물

- Node·pnpm·CMake·Emscripten 버전은 [도구 구성](../../config/toolchain-versions.json)이 소유한다. [네이티브 실행 정책](native-execution.json)에 따라 로컬 SDK·컴파일러·학습/검사 환경을 자동 설치하지 않는다. 필요한 native/WASM은 선택한 기존 CI에서 준비한다.
- 문서·JS·CSS 변경 때문에 native 빌드나 전체 자료 준비를 반복하지 않는다. 개발 reload는 현재 소스만 갱신하고 감시 대상에서 의존성·캐시·staging·검증 출력을 제외한다.
- [저장 소유자](../../tools/data/worktree-storage.mjs)가 작업트리별 참조와 공유 불변 frontend·의존성·blob을 관리한다. 편집 가능한 소스와 의존 링크는 작업트리별로 분리하며 원문 패키지를 직접 수정하지 않는다. 자료 원문·blob은 라이브러리 소유자에게 맡긴다.
- 회수 전 pin·mount·실행 프로세스·서버·쓰기/검증 lease·미완료 journal과 파일 해시·ID·하드링크·실제 경로를 대조한다. 마지막 소비자 전환 후에만 소유자를 통해 회수한다. junction을 따라가지 않고 다른 작업의 프로세스·잠금을 강제로 제거하지 않는다. 종료된 재생성 출력은 백업하지 않는다. 상세 보존·용량·안전 규칙은 AGENTS.md를 따른다.
- 개인정보·로그인·채팅 DB·원문·서명키·다른 프로젝트의 도구는 재생성 캐시와 구별한다. DB 빈 공간은 연결 종료 후 SQLite의 일관된 복구·무결성·논리 내용 검증 절차로만 회수하며 WAL을 직접 삭제하지 않는다. 삭제 논리량·물리 할당량·드라이브 여유 변화는 서로 구분한다.

## 생성·저장·게시

[생성 그래프](../../config/generated-artifacts.json)가 실제 입력·의존성·생성기·출력·검증 소유자를 선언한다. 변경한 범위와 필요한 연결 입력만 생성하며, 작은 이름 변경을 전체 자료 재생성으로 확대하지 않는다. 코드·manifest의 source·compiler·ABI·길이·해시가 맞는 산출물만 채택한다.

- 원격 시작 SHA·로컬 상태·자료 revision과 writer 잠금을 확인한다. 선언된 출력 밖의 변경은 거부한다. 모든 선택 출력 검증이 끝난 뒤 manifest/참조를 전환하고 정상 fast-forward push한다. 중간 실패·원격 경합은 원문·기존 정상판을 보존하고 미완료로 처리한다.
- 공개 자료는 커밋된 Pando main의 자료 pin으로만 결정한다. 별도 storage-main 덮어쓰기·애플리케이션 저장에서 공개 게시·배포 중 전체 GIS 재생성은 하지 않는다. [자료 정책](data-projects.md)의 소유권과 판본 격리를 유지한다.
- [자동 게시 구성](library-publication.json)이 production 활성화 여부의 정본이다. 정책·경로 정리로 허용 값을 바꾸거나 인증·원격 공개 범위를 확장하지 않는다. 특정 자료 SHA 처리 요청은 일반 정책이 아니다.
- Pages 게시 전후에는 [검증 정책](validation.md)의 코드·WASM·자료 식별값과 실제 전송 바이트 확인을 유지한다. push·workflow 성공·실제 배포는 별도로 확인한다.
- 일반 코드·리팩터링·정리는 보고서나 증거 archive를 만들지 않는다. 고유 연구·원자료·평가 근거가 생기거나 사용자가 보고서를 요청한 때만 외부 라이브러리의 선택 범위와 AGENTS.md 완료 계약을 사용한다.

## 버전과 배포 식별값

앱 버전의 정본은 [package.json](../../package.json)이다. 개발 릴리스는 0.MINOR.PATCH를 사용하며 사용자 기능·UX 구조·호환되지 않는 저장 계약 변경은 MINOR, 계약을 유지하는 수정·시각 조정·성능·리팩터링은 PATCH로 분류한다. 커밋마다 올리지 않고 실제 릴리스 범위로 결정한다.

저장 schema 정수와 자료 revision은 앱 버전과 독립적이며 해당 구조·자료가 바뀔 때만 갱신한다. [build metadata 소유자](../../scripts/generate-build-metadata.mjs)가 배포 ID·정적 자산·Worker·캐시 식별값을 일치시킨다. 수동 rN 별칭이나 브라우저의 package.json 직접 읽기는 사용하지 않는다. 작업별 변경 기록·튜토리얼을 새 Markdown으로 작성하지 않고 필요한 결과는 커밋·PR·최종 답변에 기록한다.

## 문서 유지 범위

저장소 Markdown은 에이전트 지침, 현행 정책 정본·탐색 색인, 필요한 제3자 라이선스·출처 고지만 유지한다. 일반 개발 작업의 계획·단계별 설명서·실행 일지·완료 보고·명령 튜토리얼을 만들거나 역사 기록이라는 이유로 남기지 않는다. 유효한 일반 규칙은 기존 정책 소유자에 통합하고 이전 문서와 참조를 제거한다. 실행 구성·포맷은 해당 코드·기계 판독 계약을 정본으로 삼으며 문서에 복제하지 않는다.
