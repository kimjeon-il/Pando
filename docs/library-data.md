# 외부 라이브러리 자료

앱·웹 코드는 `kimjeon-il/Pando`, 라이브러리 객체·런타임 지도·GIS 원본·보고서는 [PandoLab-library](https://github.com/kimjeon-il/PandoLab-library)에 보관한다. 라이브러리는 비Viewer 자료 작성·QGIS·저장소 운영 도구와 해당 집중 검사도 소유한다. 도구 소스 checkout에서 작은 fixture의 영향 검사만 실행하며, 자료 전용 worktree와 자료·보고서 변경에 전체 검사나 재생성을 연결하지 않는다.

`config/library-data.json`이 저장소와 코드 브랜치에 맞는 자료 커밋을 소유한다. 처음 체크아웃하거나 자료 핀을 바꾼 뒤 `pnpm.cmd data:prepare`를 실행한다. `.library-data/repository`는 고정 외부 체크아웃이다. 런타임 뷰는 공유 라이브러리 루트 `.pando-cache/materialized/<소유자>/<자료 커밋>/scopes/<준비 identity>/`에 두며, 불변 바이트는 `.pando-store/blobs/<SHA-256>`의 읽기 전용 하드링크를 공유한다. 기존 외부 체크아웃을 사용할 때만 `PANDOLAB_LIBRARY_DATA_ROOT`를 지정한다. 수정한 체크아웃을 자동 폐기하거나 덮어쓰지 않는다.

`assets/data`와 역사 GIS 입력 디렉터리는 Git에서 제외된 마운트다. 개발 서버와 기존 도구는 현재 경로로 읽지만 자료는 앱 Git에 다시 넣지 않는다. 보고서의 실제 작성 위치는 외부 체크아웃의 `reports/`이며 기존 `reportPath`/`report_path` 호출자가 이를 반환한다. 보고서는 공유 자료 저장소 루트 `reports/`에 원문 한 벌을 둔다. 과거 원문·로그·동결 테스트 fixture의 옛 URL은 역사적 증거로 보존한다.

자료 준비는 목적별로 구분한다. 기본 `pnpm.cmd data:prepare`는 제품 자산 수집기의 진입 자료와 매니페스트 의존성만 준비한다. 선택 GIS 작업은 `node tools/data/library-data.mjs --purpose=gis --include-prefix=assets/data/<입력 범위>`로 필요한 원본·출력 범위를 지정한다. 생성 스테이징은 기존 생성 그래프의 입력·출력과 의존 분야에서 이 범위를 계산한다. `--purpose=reports`는 보고서 메타데이터만 준비하며 런타임 마운트를 변경하지 않는다. 보고서의 읽기·쓰기는 계속 report helper가 담당한다.

준비 완료 identity에는 자료 revision·목적·범위·선택한 내용 identity를 포함한다. 읽기 전용 원문은 기존 CAS를 공유하고, 현재 소유자의 수정본과 새 출력은 선택 범위 안에서 독립적으로 보존한다. 이미 준비한 뷰를 수정했다면 이전 완료 표시만 믿고 재사용하지 않는다. 저장은 현재 쓰기 뷰의 선택 파일을 읽으며, 준비되지 않았거나 없는 파일을 삭제로 해석하지 않는다. 삭제는 `--remove-path=<정확한 경로>`로 명시해야 한다. 전체 archive 목록과 준비된 파일 목록은 별개다.

외부 자료 구성:

- `assets/data/territorial-entities/source/countries/`: 객체 편집의 유일한 정본 descriptor. `geometry-resources-v1` 형식에서 신원·기간·관계·출처와 논리 형상 버전을 소유하며, 좌표는 `source/geometries/sha256-<내용 해시>.json`의 불변 자원을 참조한다. 서로 다른 객체가 같은 좌표를 공유해도 논리 버전과 출처는 구분한다. 생성 청크와 국가 런타임은 이를 검증·복원한 객체에서 파생한다. 이름·설명 변경은 좌표 파일을 다시 쓰지 않는다. 선택 GIS 준비는 descriptor를 읽고 해당 좌표만 추가로 준비한다.
- `library.json`, `objects/<sha256>.json`: 과거 pin의 이전·복구 입력이다. 현행 저장·자동 입력·E3 검수는 이를 정본으로 읽거나 다시 쓰지 않는다. 별도 `territorial-source-migration.mjs --checkpoint=<경로>`가 원본을 덮어쓰지 않고 source와 필드·형상 identity를 대조한다.
- 작성용 inline 좌표를 분리하는 명시적 이전은 `node tools/data/territorial-source-migration.mjs --factor-geometries [--apply [--push]] --checkpoint=<결과 경로>`를 사용한다. 저장 전에 모든 원래 객체를 정확히 복원·비교하며, 작업 중인 바이트가 pin이나 검증된 변환 결과와 다르면 보존하고 실패한다. 구 형식은 이전 입력으로만 읽으며 현재 로더의 대체 경로로 사용하지 않는다. E3 검수는 descriptor와 선택 좌표의 독립 전송·내용 해시를 모두 검증한다.
- `assets/data/`: 현재 실행 의존 자료의 정확한 바이트. 기존 압축·해시·정밀도를 유지한다.
- 물리 육지의 `regional-land-v1` 자원은 기반 육지와 승인된 지역 교체를 참조한다. Polygon·ring 순서, 기반 좌표 구간, 유효 기간과 결과 내용 해시를 보존한다. 준비 메시의 `prepared-mesh-delta-v1`은 기반 메시의 바이트 구간과 변경 바이트를 조립하며, 원래 부동소수점 값과 삼각형 인덱스가 정확히 복원되는지 검증한다. 좌표 단순화나 재삼각분할을 수행하지 않는다. 현재 준비·배포 경로는 기반과 교체 payload만 선택하고, 이전 전체 산출물과 과거 pin은 archive에 보존한다.
- 국가 런타임의 `descriptor-geometries-v1` 목록은 전체 시대의 국가 descriptor와 `geometryAssets`를 구분한다. descriptor에는 신원·기간·관계와 논리 지오메트리 참조를 두고, 좌표는 내용별 독립 gzip payload로 공유한다. 전송 SHA-256과 해독한 좌표 내용 SHA-256은 별개다. 큰 descriptor의 전송 part는 좌표 지연 로딩 계약으로 사용하지 않는다. 메타데이터만 갱신할 때 좌표 payload와 메시를 다시 쓰지 않는다.
- `archive/index.json`, `archive/blobs/`: 논리 경로와 보관 원문의 대응. 현재 보고서는 `reports/<경로>`의 전체 원문을 직접 보관하고, 기존 revision의 압축 원문은 Git 이력에서 복구한다. 런타임과 예전 국가 입력의 기존 보관 형식은 유지한다.
- `reports/`: 전체 보고서 원문·기계 로그·첨부 원본. `.variants/<sha256>`는 다른 판본, `.edits/<브랜치>`는 독립 편집본, `.owners.json`은 브랜치별 보관 revision이다.
- `terrain/v0.13.3/`: 최신 지형 한 벌. LOD0~5는 서로 다른 배율용이며 중복 버전이 아니다. 구버전 색상 이미지와 manifest는 현재 트리에서 제거하고 Git 이력에 남긴다.

라이브러리 `main`은 보관 자료와 도구 정본을 담는다. 소스는 공용 root의 `tools/`, `tests/`, `scripts/`, `config/`, `.github/`에서 유지하고 자료 전용 linked worktree에는 복원하지 않는다. 도구의 `config/pando-code.json`은 공용 Pando 코드 입력을 별도로 고정하며 런타임 자료 pin을 대체하지 않는다. `work/ui`, `work/objects`, `work/gis`, `work/places`는 이전 당시 각 코드 브랜치의 자료를 보존한다. 객체 브랜치의 메시와 WASM 조합을 메인 조합으로 치환하지 않는다.

자료 저장소 Pages는 `gh-pages`의 지형만 게시한다. Pando Pages와 앱 패키징은 고정된 외부 자료를 준비한 뒤 현재 실행 의존 자료만 산출물에 복사한다. 앱·공통 C++ 소스·원자료·보고서를 Web 배포에 넣지 않는다. Web 배포 증거에는 코드와 자료 커밋을 각각 기록한다. 데이터 이전은 네이티브 앱 빌드·실행 검증을 대신하지 않는다.

공개 웹의 자료 기준은 **Pando main의 `config/library-data.json` 한 곳**이다. 완료한 런타임 자료는 기존 `--store-and-stage --push --include-prefix=assets/data/<scope> -- <관련 코드 경로>`로 보관·푸시하고 원격 커밋 확인 후 자료 핀을 갱신한다. 영토 자료는 변경 객체의 정본 파일·압축 chunk와 공통 `generated/v2/index.json`을 함께 명시하면 해당 객체만 보관하고 native 객체 색인도 같이 갱신한다. 빠진 짝이나 범위 밖 chunk 변경은 거부한다. 전체 논리 범위 저장도 지원하지만 이름 한 건을 보관하려고 전체 자료를 읽을 필요는 없다. 저장·동기화만으로 공개되지는 않으며, 검증한 코드와 핀을 main에 반영하면 기존 Web Pages workflow가 고정된 산출물을 게시하고 실제 응답의 코드·자료 커밋과 자산 해시를 확인한다. 중간 실패는 미완료로 기록하며 같은 커밋의 실행을 재시도한다.

별도 공개 채널 덮어쓰기와 앱의 ‘공개 Web에 게시’ 기능은 사용하지 않는다. Web 배포는 자료 저장소에 쓰지 않으므로 전용 쓰기 토큰이 필요하지 않다. 고정 자료가 없거나 해시가 다르면 배포를 중단하며 전체 GIS 생성으로 대신하지 않는다. 원자료·보고서·비공개 브랜치와 과거 공개 릴리스는 외부 저장소에 보존하되 현재 viewer가 참조하지 않는 공개판 복사본을 웹 산출물에 누적하지 않는다. 기존 자료 생성 CI의 쓰기 인증과 보고서 완료 명령은 별개로 유지한다. 사용자의 로컬 인증 정보를 CI에 복사하지 않는다.

보고서 경로는 읽기와 쓰기를 명시한다. Node.js는 `reportPath(path, { access: 'read' | 'write', root })`를 사용한다. 읽기는 해당 브랜치의 원문 또는 편집본을 반환하며, 쓰기는 요청 범위만 독립 편집본으로 준비한다. 변경 가능한 파일을 하드링크로 공유하지 않는다. 다른 판본을 섞어야 하는 디렉터리 읽기만 `reports/.views/`에 한정된 열람 작업본을 만든다.

`node tools/data/library-data.mjs --store --include-prefix=reports/<scope>`는 해당 브랜치의 편집 범위만 전체 원문으로 보관한다. 보고서만 저장하면 런타임 자료 pin은 유지한다. 미복원 파일은 삭제로 해석하지 않는다. 기존 자료 revision의 압축 원문은 Git 이력에서 계속 읽을 수 있다.

보고서 작업본은 현재 `tools/data/library-data.mjs --centralize-reports` 소유자에서 지정한 범위만 정리한다. 중앙 원문·판본·해시를 확인하기 전에는 작업본을 삭제하지 않는다. 앱 생성물은 `tools/data/worktree-storage.mjs`와 `tools/data/worktree-generated.mjs`의 명시적 대상별 명령을 사용한다.

런타임 생성기는 `withLibraryWrite({ root, prefixes }, operation)` 안에서 쓴다. 지정 범위만 독립 파일로 분리하고 비동기 작업 종료까지 쓰기 lease를 유지한다. 출력 경로를 받는 생성기는 `withLibraryOutputs`를 사용한다. 마운트 밖의 개별 staging 경로는 독립 파일로 작성하며, 같은 pin의 다른 브랜치 파일은 수정하지 않는다. 명령형 생성기는 `node tools/data/library-data.mjs --with-write --include-prefix=assets/data/<scope> -- <command> <args>`로 실행할 수 있다. 보관은 쓰기 lease 종료 후 실행한다.

라이브러리 전체 저장공간 유지보수는 별도 작업에서 `node tools/data/library-storage.mjs`로 미리보고 `--apply`로 실행한다. 이 명령은 전체 Git 저장소 유지보수를 포함할 수 있으므로 일반 코드 정리·Viewer 검증에서 자동 실행하지 않는다. 기존 migration journal과 다른 writer의 잠금은 보존한다.

Git 다운로드가 이미 있는 델타 기준 객체를 새 pack에 다시 포함할 수 있으므로, 자료 준비·읽기·저장·보고서 게시 및 확인은 같은 라이브러리 잠금 안에서 Git 중복도 정리한다. `tools/data/library-git.mjs`가 기존 pack을 재사용하고 겹치는 pack의 고유 객체만 독립 pack으로 보존한다. 삭제 전에 남길 pack의 실제 내용과 새 pack의 무결성, 모든 로컬 객체 집합과 refs·HEAD·reflog를 검증하며 이력 만료나 원격 재다운로드를 복구 근거로 삼지 않는다. `.git/pando-git-compaction.pending.json`은 다음 작업에서 재개한다. 원본 pack이 모두 그대로인 삭제 전 단계에서는 추가된 객체를 보존해 계획을 다시 만들고, 원본이 달라지거나 사라졌으면 삭제를 중단한다. 일반 자료 준비에서 라이브러리 전체 캐시를 복제하거나 전체 Git 저장소를 매번 재압축하지 않는다.

## 보고서 완료 명령

이 절차는 실제로 보존할 보고서나 근거를 작성했을 때만 사용한다. 일반 코드 수정·검사·정리는 별도 보고서를 만들지 않고 최종 답변이나 커밋·PR 설명에 결과를 기록한다.

현재 작업에서 작성·수정을 끝낸 범위를 명시한다. 파일 쓰기나 경로 helper 호출 중에는 공개하지 않고, 작업 완료 시 아래 한 명령으로 **전체 원문 보관 → 보고서 커밋 → 푸시 → 원격 원문 검증**을 수행한다. `--push`를 따로 기억할 필요가 없다.

`pnpm.cmd reports:publish --include-prefix=reports/<scope>`

동일한 직접 호출은 `node tools/data/library-data.mjs --publish-reports --include-prefix=reports/<scope>`이다. 여러 범위는 `--include-prefix`를 반복한다. 현재 브랜치의 선택한 편집본만 공유 라이브러리 main에 보관한다. 분리된 자료 작업트리의 미공개 런타임 이력은 푸시하지 않으며, 앱 자료 핀·다른 작업의 편집본을 바꾸거나 런타임 자료를 준비하지 않는다.

원격 상태를 다시 확인하려면 `pnpm.cmd reports:check --include-prefix=reports/<scope>` 또는 같은 Node 명령의 `--check-reports`를 사용한다. 원격 커밋의 보관 목록과 실제 파일 바이트를 현재 편집본의 SHA-256·길이에 대조한다. 이후 문서를 수정하면 다시 게시해야 완료된다. 결과의 `revision`, `files`, `prefixes`를 기록한다.

승인된 보고서 폐기는 게시·확인 명령에 `--remove-path=reports/<scope>/<file>`을 파일별로 반복한다. 해당 경로는 선택한 범위 안에 있어야 하며, 현재 브랜치의 편집 원본을 먼저 제거해야 한다. 명시한 파일만 보관 색인과 원격 Git 트리에서 제거하고 두 곳의 부재를 확인한다. 폴더가 비었거나 미복원 상태라는 이유로 다른 파일을 삭제하지 않는다. 브랜치별 다른 판본도 폐기할 때는 해당 소유자의 편집본을 확인한 뒤 같은 명시적 경로로 처리한다.

기존 `--store`는 명시적인 중간 저장·혼합 자료 보관 명령이다. 그것만 실행하거나 로컬 커밋만 만든 상태는 보고서 작업 완료가 아니다. 잠금·자료 main의 미공개 비보고서 변경·분기·푸시 거부·원격 내용 불일치는 오류로 끝나며, 진행 중인 원문과 대기 커밋을 남긴다. 다른 작업의 잠금을 지우거나 강제 병합·푸시로 해결하지 않는다.

## 보고서 주제와 판본

새 보고서 경로는 아래 여섯 주제만 사용하며, Node.js 경로 helper에
`reports/<주제>/<작업 범위>`를 직접 전달한다. 옛 분류나 경로 별칭을 만들지 않는다.

| 폴더 | 세부 분류 |
| --- | --- |
| `borders` | `history` 존속기간·역사, `reconstruction` 국가별 재구성, `validation` 검증, `data` 자료 |
| `hydro` | `names` 명칭, `calibration` 교정, `connectivity` 연결성, `releases` 버전 기록 |
| `places` | 도시·지명 조사 |
| `terrain` | 지형 조사 색인과 고정 원자료 링크 |
| `map-analysis` | `corpus` 학습 자료, `models` 모델, `reports` 평가·조사 |
| `development` | `ui`, `rendering`, `performance`, `ci`, `integrations`, `releases`, `storage`, `native` |

보고서와 스크린샷·로그·검증 JSON은 같은 작업 묶음에 둔다. 공용 첨부는
정본 한 곳에 보관하고 링크한다. 런타임·GIS 원자료 마운트는 유지한다.
보고서 revision은 런타임 pin과 독립적이며, 자료 준비·저장으로 되돌리지 않는다.
브랜치별 다른 판본은 `refs/pando/reports/<owner>`와 기존 편집본으로 보존한다.
완료된 범위만 보관·커밋·푸시·원격 검증하고 다른 작업의 편집본은 공개하지 않는다.

## 보고서 주제 재배치 명령

`node tools/data/library-data.mjs --organize-reports`는 기존→새 경로, 충돌과 예상 추가
공간만 표시한다. `--apply`는 쓰기 작업이 끝난 뒤 기존 잠금 안에서 동일 드라이브
이동·SHA-256 대조·공개 main 커밋·푸시·원격 확인을 수행한다. 중단하면 같은 명령으로
`.pando-store/report-organization.pending.json`을 재개한다. 잠금은 강제로 제거하지 않는다.
원문과 비공개 편집본의 전체 대응표는 로컬 private evidence에, 공개 원문 대응표는
`reports/development/storage/library-organization-2026-10-25`에 남긴다. 앱 main 통합·배포나
비공개 이력 푸시는 포함하지 않는다. 반복 적용은 추가 이동·커밋을 만들지 않는다.


## 비활성 자동 자료 수신 계약

`library-data-auto-sync.yml`은 고정된 두 저장소의 같은 `main` 또는 `work/gis` 브랜치만 연결한다. 자료 저장소의 `notify-library-data.yml`은 `library.json`, `objects/**`, `archive/index.json` 변경 SHA를 고정 앱 workflow로 알릴 뿐, checkout·검사·생성은 하지 않는다. `PANDO_AUTO_DATA_NOTIFY_TOKEN`이 없으면 명시적으로 실패한다. 새 토큰 생성·등록은 이 준비 작업에 포함되지 않는다.

앱 `work/gis` push는 작은 계약 테스트만 실행한다. 명시적인 같은 브랜치 수신 호출만 `work/gis` 자료 생성·저장·핀 연결을 허용하며 Pages를 배포하지 않는다. `main` 수신·시간별 복구·Pages 완료 후 복구는 커밋된 `docs/policies/library-publication.json`의 `productionEnabled: true`와 실행 환경의 production 허용이 모두 있어야 한다. 현재 production 설정은 **false**다. workflow를 기본 브랜치에 설치하고 기존 전용 notifier 토큰 및 자료 쓰기 권한을 활성화하는 일과 production 허용은 별도의 명시적 승인 대상이다.

수신 작업은 현재의 고정 브랜치 전체 Git 조상과 정확한 자료 SHA를 읽고, archive가 가리키는 source/countries와 source/views/world.json만 편집 정본으로 읽는다. 각 전송·해시를 검증한 뒤 기존 생성 소유자로 파생한다. 구 native 객체나 생성 청크의 변경은 source로 역동기화하지 않는다. 다른 family는 보존하거나 지원하지 않는 변경으로 거절한다. 오래된 알림은 최신 head와 의미 지문으로 재조정하며 생성 커밋의 재알림도 일괄 actor 제외로 숨기지 않는다. 저장된 완성 자료와 앱 핀을 독립적으로 확인하므로 중간 실패는 다음 복구에서 이어갈 수 있다. 실행 로그 artifact는 진단일 뿐 완료 증거가 아니며 pending/incomplete를 배포 완료로 해석하지 않는다. GitHub 대기·job·생성 시간 때문에 즉시 반영이나 무지연을 보장하지 않는다.

앱 쓰기는 해당 sync job의 기존 ephemeral `GITHUB_TOKEN`, 자료 쓰기는 기존 `PANDOLAB_LIBRARY_WRITE_TOKEN`만 사용한다. checkout의 표준 자격 증명 정리 외에 새로운 영구 자격 증명 저장소는 만들지 않는다. 기존 P2 및 `web-pages.yml` 경로·권한·배포 정책은 변경하지 않는다.
