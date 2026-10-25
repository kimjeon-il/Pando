# 상설 작업트리 저장공간

상설 작업트리와 각 target/build 디렉터리는 독립적으로 유지한다. 라이브러리 자료는 기존 라이브러리 불변 pool을 사용하고, App 전용 staging 바이트는 로컬 활성화의 `D:/build/cache/pandolab/blobs`를 사용한다. 같은 바이트만 읽기 전용 하드링크로 공유한다. 편집 가능한 소스와 증분 target을 하드링크로 합치지 않는다.

## 준비와 컴파일

`node tools/worktree-storage.mjs --activate-compiler-cache`는 공식 ZIP 해시와 실행 버전을 확인하고, 공통 Git 디렉터리의 `pando-storage.json`에 이 저장소만 활성화한다. sccache 0.19.0은 고정 도구 경로에 한 벌, 캐시는 2GiB 상한이다. 다른 wrapper/서버 설정은 충돌로 실패한다. 시스템 전역 환경은 바꾸지 않는다.

현재 브랜치의 `dev.ps1`, Android 빌드, 패키징 진입점과 루트 CMake는 활성화를 읽는다. Cargo 증분 설정은 기존 값을 유지한다. 지원되지 않는 incremental/link 작업은 캐시 적중으로 계산하지 않는다. Rust는 cwd를 키에 포함한다. 공통 registry 의존성의 동일 입력/cwd와 서로 다른 branch output은 공유할 수 있지만, workspace의 경로 키를 약화하지 않는다. `SCCACHE_BASEDIRS`는 활성화하지 않는다.

직접 빌드하거나 아직 이 코드가 통합되지 않은 브랜치에서는 해당 작업트리를 cwd로 하고 canonical 도구를 명시한다:

```powershell
node D:/dev/worktrees/objects/tools/worktree-storage.mjs --root=D:/dev/worktrees/ui --with-compiler-cache -- cargo build
node D:/dev/worktrees/objects/tools/worktree-storage.mjs --root=D:/dev/worktrees/gis --with-compiler-cache -- cmake --preset pando-core
```

동일 pin도 수정 중인 입력과 옵션/ABI가 다르면 캐시를 공유하지 않는다. 캐시 적중은 컴파일러 결정성이나 기존 WASM 재현성 CI의 통과를 뜻하지 않는다. 상설 브랜치 간 소스 통합은 별도의 명시적 요청을 따른다.

## 실제 정리

```powershell
./tools/cleanup-reference-analysis-caches.ps1 -WorktreeStorageOnly
./tools/cleanup-reference-analysis-caches.ps1 -WorktreeStorageOnly -Apply
node tools/worktree-storage.mjs --prune-blobs
node tools/worktree-storage.mjs --prune-blobs --apply
node tools/worktree-storage.mjs --share-retired-qt
node tools/worktree-storage.mjs --share-retired-qt --apply
```

미리보기는 source evidence의 SHA-256/크기와 실제 stage 파일을 비교한다. 적용은 전용 storage lock과 각 App stage writer lock을 유지하고 파일 ID·hash를 재검사한다. stage 증거와 다른 파일은 private/unfinished로 보존한다. 중단 시 `migration.pending.json`을 보존하고 동일 `--apply` 또는 `--resume`으로 재개한다. 원본 바이트는 pool 검증 후에만 교체한다. 다른 작업의 잠금은 제거하지 않는다.

기존 staging 소비 경로를 유지하며, library revision이 바뀌었더라도 이전 staging 바이트와 정확히 같은 불변 library blob이 있으면 이를 재사용한다. live private input을 링크하지 않는다. 쓰기는 새 pending stage를 만드는 기존 owner를 통해 수행한다. 기존 공유 stage를 직접 수정하면 실패한다.

pnpm 설치는 동일 `D:/.pnpm-store/v11`을 사용하되 작업트리마다 독립 view와 현재 lockfile을 유지한다. 디렉터리 전체 junction 공유는 사용하지 않는다. 설치 시 `--frozen-lockfile --package-import-method=hardlink`로 버전 변경 없이 재사용한다.

unreferenced App blob 정리는 알려진 pool 내부의 SHA-256과 크기를 확인하고, link count가 1이며 writer/consumer가 없는 것만 삭제한다. 원본, SDK, 실행 중인 Python/QGIS, 증분 Rust/CMake 캐시는 이름·나이·ignored 여부만으로 삭제하지 않는다. 논리 삭제량, 고유 파일 ID 감소, 실제 드라이브 여유 변화는 별도로 기록한다.

과거 Qt 비교의 SDK 사본은 알려진 `build-native/p9/qt-pair-*` 범위, Qt 6.8.3 source identity, 종료된 executable 상태를 확인한 경우에만 동일 바이트를 공유한다. 현재 소비 경로와 고유 SDK 바이트는 보존한다. source identity가 없는 두 과거 폴더는 건드리지 않는다. 중단 시 `runtime-migration.pending.json`을 보존하고 같은 명령으로 재개한다.
