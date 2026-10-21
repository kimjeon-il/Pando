# 외부 라이브러리 자료

앱·웹 코드는 `kimjeon-il/Pando`, 라이브러리 객체·런타임 지도·GIS 원본·보고서는 [PandoLab-library-data](https://github.com/kimjeon-il/PandoLab-library-data)에 보관한다. 자료 저장소에서는 검사·테스트·재생성 작업을 실행하지 않는다.

`config/library-data.json`이 저장소와 코드 브랜치에 맞는 자료 커밋을 소유한다. 처음 체크아웃하거나 자료 핀을 바꾼 뒤 `pnpm.cmd data:prepare`를 실행한다. 기본 외부 체크아웃과 풀어놓은 자료는 고정 경로 `.library-data/repository`, `.library-data/materialized/<자료 커밋>/`에 둔다. 기존 외부 체크아웃을 사용할 때만 `PANDOLAB_LIBRARY_DATA_ROOT`를 지정한다. 수정한 체크아웃을 자동 폐기하거나 덮어쓰지 않는다.

`assets/data`와 역사 GIS 입력 디렉터리는 Git에서 제외된 마운트다. 개발 서버와 기존 도구는 현재 경로로 읽지만 자료는 앱 Git에 다시 넣지 않는다. 보고서의 실제 작성 위치는 외부 체크아웃의 `reports/`이며 기존 `reportPath`/`report_path` 호출자가 이를 반환한다. 장문의 기존 보고서는 발췌 열람본과 압축 원문을 연결한다. 과거 원문·로그·동결 테스트 fixture의 옛 URL은 역사적 증거로 보존한다.

외부 자료 구성:

- `library.json`, `objects/<sha256>.json`: 앱의 기존 편집·동기화 형식. 편집의 정본이다.
- `assets/data/`: 현재 실행 의존 자료의 정확한 바이트. 기존 압축·해시·정밀도를 유지한다.
- `archive/index.json`, `archive/blobs/`: 논리 경로와 무손실 압축 원본의 대응. 같은 원문은 한 압축 blob을 공유한다. 여기에 보존한 예전 국가 입력은 동결된 출처이며 두 번째 편집 정본이 아니다.
- `reports/`: 보고서 색인·열람본·첨부 이미지. 기계 로그·큰 JSON은 압축 원문을 연결한다.
- `terrain/v0.13.3/`: 최신 지형 한 벌. LOD0~5는 서로 다른 배율용이며 중복 버전이 아니다. 구버전 색상 이미지와 manifest는 현재 트리에서 제거하고 Git 이력에 남긴다.

자료 `main`은 보관용 전체 자료를 담는다. `work/ui`, `work/objects`, `work/gis`, `work/places`는 이전 당시 각 코드 브랜치의 자료를 보존한다. 객체 브랜치의 메시와 WASM 조합을 메인 조합으로 치환하지 않는다.

자료 저장소 Pages는 `gh-pages`의 지형만 게시한다. Pando Pages와 앱 패키징은 고정된 외부 자료를 준비한 뒤 현재 실행 의존 자료만 산출물에 복사한다. 앱·공통 C++ 소스·원자료·보고서를 Web 배포에 넣지 않는다. Web 배포 증거에는 코드와 자료 커밋을 각각 기록한다. 데이터 이전은 네이티브 앱 빌드·실행 검증을 대신하지 않는다.

독립 라이브러리 게시 workflow는 Pando에만 있다. 공개 자료 읽기에 별도 비밀키가 필요하지 않다. 외부 저장소에 결과를 쓰는 workflow만 해당 저장소 쓰기 권한을 가진 `PANDOLAB_LIBRARY_WRITE_TOKEN`이 필요하다. 사용자의 로컬 인증 정보를 CI에 자동 복사하지 않는다. 게시 결과도 외부 자료 `main`에 저장하며 Pando의 별도 `library-data` 브랜치를 만들지 않는다.

보고서를 사용하는 도구에는 발췌본 대신 원문을 제공한다. `reports` 마운트와 경로 helper는 외부 체크아웃 `.working/<자료 커밋>/reports/`의 원문 작업본을 읽고 쓴다. `node tools/library-data.mjs --store`가 변경분을 압축해 `archive/`와 `reports/` 열람본에 저장하고 자료 핀을 갱신한다. 원격 저장까지 할 때는 `--push`를 추가한다. 이 명령은 검사나 자료 계산을 실행하지 않는다. 이전 자료 핀의 작업본은 자동 삭제하지 않는다.
