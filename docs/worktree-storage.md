# 상설 작업트리 저장공간

상설 작업트리 소스는 독립적으로 유지한다. 로컬 native target은 CI 전환 후 종료된 산출물로 정리한다. 라이브러리 자료는 기존 라이브러리 불변 pool을 사용하고, App 전용 staging 바이트는 로컬 활성화의 `D:/build/cache/pandolab/blobs`를 사용한다. 같은 바이트만 읽기 전용 하드링크로 공유한다. 편집 가능한 소스와 증분 target을 하드링크로 합치지 않는다.

## 로컬 컴파일 비활성화

현재 work/ui의 개발·빌드 진입점은 CI 실행기를 받는다. Rust·C++·Android 컴파일은
Actions에서 수행하고 로컬에는 Node·Git·브라우저·앱·ADB를 남긴다. SDK 자동 설치와
로컬 컴파일 fallback은 없다. 세부 사용법은 apps/web-shell/README.md를 따른다.

`node tools/worktree-storage.mjs --disable-local-compiler`는 활성 빌드를 거부하고,
소유한 sccache 서버만 확인 후 종료한다. 공통 Git의 pando-storage.json에 compilerEnabled=false를
기록한다. 이 상태에서 --compiler-config는 active:false, --compiler-env는 빈 객체다.
App staging·native artifact·라이브러리의 불변 blob 공유는 계속 동작하며 삭제된 wrapper를
실행하지 않는다. 다른 프로젝트의 전역 환경, Qt·Java·공용 컴파일러는 변경하지 않는다.
상설 브랜치 간 코드 통합은 별도 요청을 따른다.

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

강제 종료된 정리 프로세스가 남긴 명시적인 PID/root/schema의 stage lease만 PID가 죽었음을 확인한 뒤 재개할 수 있다. 살아 있는 소유자와 빈/알 수 없는 잠금은 보호한다. 어떤 migration journal이라도 남아 있으면 blob GC는 복구 완료 전까지 중지한다.

기존 staging 소비 경로를 유지하며, library revision이 바뀌었더라도 이전 staging 바이트와 정확히 같은 불변 library blob이 있으면 이를 재사용한다. live private input을 링크하지 않는다. 쓰기는 새 pending stage를 만드는 기존 owner를 통해 수행한다. 기존 공유 stage를 직접 수정하면 실패한다.

pnpm 설치는 동일 `D:/.pnpm-store/v11`을 사용하되 작업트리마다 독립 view와 현재 lockfile을 유지한다. 디렉터리 전체 junction 공유는 사용하지 않는다. 설치 시 `--frozen-lockfile --package-import-method=hardlink`로 버전 변경 없이 재사용한다.

unreferenced App blob 정리는 알려진 pool 내부의 SHA-256과 크기를 확인하고, link count가 1이며 writer/consumer가 없는 것만 삭제한다. 원본, SDK, 실행 중인 Python/QGIS, 증분 Rust/CMake 캐시는 이름·나이·ignored 여부만으로 삭제하지 않는다. 논리 삭제량, 고유 파일 ID 감소, 실제 드라이브 여유 변화는 별도로 기록한다.

과거 Qt 비교의 SDK 사본은 알려진 `build-native/p9/qt-pair-*` 범위, Qt 6.8.3 source identity, 종료된 executable 상태를 확인한 경우에만 동일 바이트를 공유한다. 현재 소비 경로와 고유 SDK 바이트는 보존한다. source identity가 없는 두 과거 폴더는 건드리지 않는다. 중단 시 `runtime-migration.pending.json`을 보존하고 같은 명령으로 재개한다.

## 종료된 생성물 삭제

```powershell
node tools/worktree-storage.mjs --retire-generated=requests.json --output=manifest.json
node tools/worktree-storage.mjs --retire-generated=manifest.json --apply --output=result.json
./tools/cleanup-reference-analysis-caches.ps1 -WorktreeStorageOnly -RetireGeneratedManifest manifest.json -Apply
node tools/worktree-storage.mjs --retire-qt-runtimes --apply --output=retired-qt.json
node tools/worktree-storage.mjs --compact-git --apply --output=git-compaction.json
```

요청의 각 항목은 상설 worktree `root`, 허용된 생성물 `path`, 명시적인 `action` (`delete` 또는 `relocate`), 생산자/복구 근거 `reason`을 포함한다. 재배치는 승인된 공유 toolchain 또는 선택된 라이브러리 증거 범위의 `destination`을 지정한다. 적용은 요청을 다시 해석하지 않고 정확한 미리보기 명세의 해시·파일 ID를 확인한다. 소스와 미추적 WIP, junction, 실행 중 Cargo/Gradle/native/browser 작업은 보호한다. `generated-retirement.pending.json`이 남으면 동일 명세로 재개한다. 완료 cursor와 직전 작업만 journal에 보관하며 파일 전체 백업은 만들지 않는다.

Cargo 정리는 현재 seed와 보존할 ABI의 모든 fingerprint에서 호스트 의존성까지 추적한다. 연결되지 않은 과거 fingerprint/deps/build 출력과 완료되지 않은 빌드 스크립트 출력만 후보가 된다. CI 전환 전 target/packaged 실행본은 새 CI 실행기의 실제 검증 후에만 정리한다. 실행 파일 없는 과거 Qt view 삭제는 기존 content owner를 사용하고 출처 원문을 결과에 보존한다.

앱 Git 정리는 공통 저장소에서 미참조 객체까지 포함해 기존 객체 집합을 완전히 보존하는 새 pack을 검증한 뒤 사본만 제거한다. refs/reflog 만료, prune, 원격 복구 의존은 없다. 새 pack의 예상 최대 공간에 5 GiB 여유가 있어야 하며 중단 시 `app-git-compaction.pending.json`으로 재개한다.

CMake와 Emscripten 버전은 config/toolchain-versions.json을 기준으로 CI에서 준비한다.
