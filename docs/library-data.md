# 외부 라이브러리 자료

앱·웹 코드는 `kimjeon-il/Pando`, 라이브러리 객체·런타임 지도·GIS 원본·보고서는 [PandoLab-library-data](https://github.com/kimjeon-il/PandoLab-library-data)에 보관한다. 자료 저장소에서는 검사·테스트·재생성 작업을 실행하지 않는다.

`config/library-data.json`이 저장소와 코드 브랜치에 맞는 자료 커밋을 소유한다. 처음 체크아웃하거나 자료 핀을 바꾼 뒤 `pnpm.cmd data:prepare`를 실행한다. `.library-data/repository`는 고정 외부 체크아웃이다. 런타임 뷰는 공유 라이브러리 루트 `.pando-cache/materialized/<브랜치>/<자료 커밋>/`에 두며, 불변 바이트는 `.pando-store/blobs/<SHA-256>`의 읽기 전용 하드링크를 공유한다. 기존 외부 체크아웃을 사용할 때만 `PANDOLAB_LIBRARY_DATA_ROOT`를 지정한다. 수정한 체크아웃을 자동 폐기하거나 덮어쓰지 않는다.

`assets/data`와 역사 GIS 입력 디렉터리는 Git에서 제외된 마운트다. 개발 서버와 기존 도구는 현재 경로로 읽지만 자료는 앱 Git에 다시 넣지 않는다. 보고서의 실제 작성 위치는 외부 체크아웃의 `reports/`이며 기존 `reportPath`/`report_path` 호출자가 이를 반환한다. 보고서는 공유 자료 저장소 루트 `reports/`에 원문 한 벌을 둔다. 과거 원문·로그·동결 테스트 fixture의 옛 URL은 역사적 증거로 보존한다.

외부 자료 구성:

- `library.json`, `objects/<sha256>.json`: 앱의 기존 편집·동기화 형식. 편집의 정본이다.
- `assets/data/`: 현재 실행 의존 자료의 정확한 바이트. 기존 압축·해시·정밀도를 유지한다.
- `archive/index.json`, `archive/blobs/`: 논리 경로와 보관 원문의 대응. 현재 보고서는 `reports/<경로>`의 전체 원문을 직접 보관하고, 기존 revision의 압축 원문은 Git 이력에서 복구한다. 런타임과 예전 국가 입력의 기존 보관 형식은 유지한다.
- `reports/`: 전체 보고서 원문·기계 로그·첨부 원본. `.variants/<sha256>`는 다른 판본, `.edits/<브랜치>`는 독립 편집본, `.owners.json`은 브랜치별 보관 revision이다.
- `terrain/v0.13.3/`: 최신 지형 한 벌. LOD0~5는 서로 다른 배율용이며 중복 버전이 아니다. 구버전 색상 이미지와 manifest는 현재 트리에서 제거하고 Git 이력에 남긴다.

자료 `main`은 보관용 전체 자료를 담는다. `work/ui`, `work/objects`, `work/gis`, `work/places`는 이전 당시 각 코드 브랜치의 자료를 보존한다. 객체 브랜치의 메시와 WASM 조합을 메인 조합으로 치환하지 않는다.

자료 저장소 Pages는 `gh-pages`의 지형만 게시한다. Pando Pages와 앱 패키징은 고정된 외부 자료를 준비한 뒤 현재 실행 의존 자료만 산출물에 복사한다. 앱·공통 C++ 소스·원자료·보고서를 Web 배포에 넣지 않는다. Web 배포 증거에는 코드와 자료 커밋을 각각 기록한다. 데이터 이전은 네이티브 앱 빌드·실행 검증을 대신하지 않는다.

독립 라이브러리 게시 workflow는 Pando에만 있다. 공개 자료 읽기에 별도 비밀키가 필요하지 않다. 외부 저장소에 결과를 쓰는 workflow만 해당 저장소 쓰기 권한을 가진 `PANDOLAB_LIBRARY_WRITE_TOKEN`이 필요하다. 사용자의 로컬 인증 정보를 CI에 자동 복사하지 않는다. 게시 결과도 외부 자료 `main`에 저장하며 Pando의 별도 `library-data` 브랜치를 만들지 않는다.

보고서 경로는 읽기와 쓰기를 명시한다. JS는 `reportPath(path, { access: 'read' | 'write', root })`, Python은 `report_path(path, access='read' | 'write')`를 사용한다. 읽기는 해당 브랜치의 원문 또는 편집본을 반환하며, 쓰기는 요청 범위만 독립 편집본으로 준비한다. 변경 가능한 파일을 하드링크로 공유하지 않는다. 다른 판본을 섞어야 하는 디렉터리 읽기만 `reports/.views/`에 한정된 열람 작업본을 만든다.

`node tools/library-data.mjs --store --include-prefix=reports/<scope>`는 해당 브랜치의 편집 범위만 전체 원문으로 보관한다. 보고서만 저장하면 런타임 자료 pin은 유지한다. 미복원 파일은 삭제로 해석하지 않는다. 기존 자료 revision의 압축 원문은 Git 이력에서 계속 읽을 수 있다.

기존 작업본을 정리할 때는 PandoLab에서 `./tools/cleanup-reference-analysis-caches.ps1 -ReportWorkingCopiesOnly`로 미리보고 `-Apply`로 실제 재배치와 삭제를 실행한다. 모든 작업트리의 보고서와 private evidence를 먼저 해시로 대조하고, 중앙 원문을 검증한 뒤 사본만 삭제한다. 사용 중인 원본·미보관 변경·상설 작업트리·런타임/WASM 조합은 보존한다. `private-evidence/<owner>/<source revision>`는 공개 보관 대상과 분리된 원본 위치다.

런타임 생성기는 `withLibraryWrite({ root, prefixes }, operation)` 또는 Python의 `library_write(prefixes, root=...)` 안에서 쓴다. 지정 범위만 독립 파일로 분리하고 비동기 작업 종료까지 쓰기 lease를 유지한다. 출력 경로를 받는 생성기는 `withLibraryOutputs`/`library_output`을 사용한다. 마운트 밖의 개별 staging 경로는 독립 파일로 작성하며, 같은 pin의 다른 브랜치 파일은 수정하지 않는다. 명령형 생성기는 `node tools/library-data.mjs --with-write --include-prefix=assets/data/<scope> -- <command> <args>`로 실행할 수 있다. 보관은 쓰기 lease 종료 후 실행한다.

전체 저장소 정리는 `./tools/cleanup-reference-analysis-caches.ps1 -LibraryStorageOnly`로 미리보고 `-Apply`로 적용한다. 실행 중인 서버·쓰기 lease를 확인하고, 현재 pin과 미보관 작업본을 보존한 뒤 구 캐시만 제거한다. Git 정리는 미참조 객체를 포함한 모든 로컬 객체를 promisor 여부에 따라 다시 압축하고, 새 pack의 정확한 객체 집합·무결성과 refs·HEAD·reflog를 검증한다. 과거 index 사본과 서로 다른 옛 작업본은 `private-evidence/storage-migrations/<작업 ID>/`에 출처와 함께 보존한다. 중단 시 같은 명령으로 `.pando-store/storage-migration.pending.json`을 재개한다. 종료가 확인된 잠금 소유자의 파일만 회수하며 실행 중인 작업의 잠금은 보존한다.

Git 다운로드가 이미 있는 델타 기준 객체를 새 pack에 다시 포함할 수 있으므로, 자료 준비·읽기·저장·보고서 게시 및 확인은 같은 라이브러리 잠금 안에서 Git 중복도 정리한다. `tools/library-git.mjs`가 기존 pack을 재사용하고 겹치는 pack의 고유 객체만 독립 pack으로 보존한다. 삭제 전에 남길 pack의 실제 내용과 새 pack의 무결성, 모든 로컬 객체 집합과 refs·HEAD·reflog를 검증하며 이력 만료나 원격 재다운로드를 복구 근거로 삼지 않는다. `.git/pando-git-compaction.pending.json`은 다음 작업에서 재개한다. 원본 pack이 모두 그대로인 삭제 전 단계에서는 추가된 객체를 보존해 계획을 다시 만들고, 원본이 달라지거나 사라졌으면 삭제를 중단한다. 일반 자료 준비에서 라이브러리 전체 캐시를 복제하거나 전체 Git 저장소를 매번 재압축하지 않는다.

## 보고서 완료 명령

현재 작업에서 작성·수정을 끝낸 범위를 명시한다. 파일 쓰기나 경로 helper 호출 중에는 공개하지 않고, 작업 완료 시 아래 한 명령으로 **전체 원문 보관 → 보고서 커밋 → 푸시 → 원격 원문 검증**을 수행한다. `--push`를 따로 기억할 필요가 없다.

`pnpm.cmd reports:publish --include-prefix=reports/<scope>`

동일한 직접 호출은 `node tools/library-data.mjs --publish-reports --include-prefix=reports/<scope>`이다. 여러 범위는 `--include-prefix`를 반복한다. 현재 브랜치의 선택한 편집본만 공유 라이브러리 main에 보관한다. 분리된 자료 작업트리의 미공개 런타임 이력은 푸시하지 않으며, 앱 자료 핀·다른 작업의 편집본을 바꾸거나 런타임 자료를 준비하지 않는다.

원격 상태를 다시 확인하려면 `pnpm.cmd reports:check --include-prefix=reports/<scope>` 또는 같은 Node 명령의 `--check-reports`를 사용한다. 원격 커밋의 보관 목록과 실제 파일 바이트를 현재 편집본의 SHA-256·길이에 대조한다. 이후 문서를 수정하면 다시 게시해야 완료된다. 결과의 `revision`, `files`, `prefixes`를 기록한다.

기존 `--store`는 명시적인 중간 저장·혼합 자료 보관 명령이다. 그것만 실행하거나 로컬 커밋만 만든 상태는 보고서 작업 완료가 아니다. 잠금·자료 main의 미공개 비보고서 변경·분기·푸시 거부·원격 내용 불일치는 오류로 끝나며, 진행 중인 원문과 대기 커밋을 남긴다. 다른 작업의 잠금을 지우거나 강제 병합·푸시로 해결하지 않는다.

## 보고서 주제와 판본

새 보고서 경로는 아래 여섯 주제만 사용하며, Node/Python 경로 helper에
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

`node tools/library-data.mjs --organize-reports`는 기존→새 경로, 충돌과 예상 추가
공간만 표시한다. `--apply`는 쓰기 작업이 끝난 뒤 기존 잠금 안에서 동일 드라이브
이동·SHA-256 대조·공개 main 커밋·푸시·원격 확인을 수행한다. 중단하면 같은 명령으로
`.pando-store/report-organization.pending.json`을 재개한다. 잠금은 강제로 제거하지 않는다.
원문과 비공개 편집본의 전체 대응표는 로컬 private evidence에, 공개 원문 대응표는
`reports/development/storage/library-organization-2026-10-25`에 남긴다. 앱 main 통합·배포나
비공개 이력 푸시는 포함하지 않는다. 반복 적용은 추가 이동·커밋을 만들지 않는다.
