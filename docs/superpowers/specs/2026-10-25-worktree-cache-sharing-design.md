# 상설 작업트리 중복 정리와 공용 컴파일 캐시 설계

상태: 사용자 승인 완료. 구현 결과와 확인된 제한은 `docs/worktree-storage.md` 및 완료 보고서를 따른다. 사용자는 main과 모든 상설 브랜치를 먼저 동기화하고, 현재 중복뿐 아니라 Rust/C++ 공용 컴파일 캐시 구축까지 포함하도록 선택했다.

## 완료한 선행 작업과 조사

- main, work/ui, work/gis, work/objects, work/places의 로컬·origin HEAD를 모두 `93b6e1b17477080687e31b3eaa16f2596b9c7010`으로 맞췄다. fast-forward와 atomic push만 사용했다.
- UI의 미완성 변경 219개는 동기화 전후 내용 해시와 index가 동일했다. 작업 중인 변경을 커밋하거나 stash/reset/clean하지 않았다.
- 동기화 후 자료 pin은 모두 `127e51c3457df87786ecf3aa5ad98ded690928df`이다. Objects/Places의 자료 마운트도 기존 불변 블롭으로 준비했다. 두 이전 view에는 private 파일이 없었다.
- Git object store는 이미 공통 `.git` 한 곳이다. 브랜치별 Git 보관소를 새로 합칠 필요는 없다.
- 링크를 따라가지 않고 캐시 후보 98,763개 파일을 조사했다. 논리 합계 24,839,301,262 bytes, 고유 파일 ID 기준 합계 21,353,097,225 bytes였다. 이 차이 3,486,204,037 bytes는 이미 공유된 파일이므로 추가 절감량이 아니다. NTFS allocation과 드라이브 여유 변화는 별도 측정한다.
- 256KiB 이상 파일 중 서로 다른 작업트리와 파일 ID를 가진 동일 SHA-256 그룹 87개, 추가 payload 258,081,580 bytes를 확인했다. 전체 중복의 확정값이 아닌 해당 범위의 하한이다. 삭제 직전 다시 조사한다.
- 가장 큰 후보는 UI Cargo target 12.70GB 논리/9.51GB 파일 ID 합계, UI Python 환경 4.61GB, Objects emsdk upstream 1.16GB다. Python 환경은 실제 QGIS MCP 프로세스들이 사용 중이다. 큰 Rust 캐시는 현재 UI 한 곳에 집중돼 있다.
- pnpm은 이미 `D:/.pnpm-store/v11`을 사용한다. 전체 node_modules를 단순히 하나의 쓰기 가능한 폴더로 연결하지 않는다.
- 원본 경로·해시·파일 ID가 포함된 조사와 WIP 기록은 라이브러리 `private-evidence/worktree-storage/20261025`에 보존한다. 공개 보고서에는 필요한 집계만 싣는다.

## 방식과 범위

미사용 사본만 삭제하면 활성 캐시 공유 요구를 만족하지 못한다. 모든 Cargo/CMake target을 하나의 쓰기 가능한 폴더로 합치거나 편집 가능한 소스를 하드링크하면 브랜치 간 변경이 섞이므로 채택하지 않는다.

제안은 **기존 도구의 공용 캐시 + 불변 staging 파일 공유 + 독립 작업본**이다. 사용자가 Rust/C++ 공용 컴파일 캐시까지 포함하도록 선택한 범위를 따른다. 각 브랜치의 소스, pin, 고정 build/target 경로와 증분 상태는 유지한다. 패키지 관리자와 빌드 도구가 소유한 메타데이터를 별도 유사 구현으로 대체하지 않는다.

이번 범위에는 5개 작업트리의 의존성, App staging, 네이티브/WASM 빌드 산출물, 종료된 검증 캐시 및 컴파일 캐시 진입점이 포함된다. 원본 자료·학습/평가 증거·SDK·현재 Python 환경은 보호한다. Git 이력 만료/prune, 새 clone/worktree/상설 브랜치, 설치 패키지 제작, 모델 재학습 및 게시 WASM 재생성은 하지 않는다.

## 공용 저장 위치와 소유권

- 이미 존재하는 라이브러리 runtime blob은 `.pando-store/blobs`를 정본으로 유지한다. App staging 때문에 같은 바이트를 새 app pool에 복제하지 않는다.
- 앱 전용 불변 생성물은 `D:/build/cache/pandolab/blobs/<SHA-256>`에 보관한다. 현재 참조하는 view와 출처를 기록하고, `.dist` 등 기존 소비 경로에는 읽기 전용 하드링크를 둔다. 수정 가능한 원본은 링크하지 않는다.
- 공용 컴파일 캐시는 `D:/build/cache/pandolab/sccache`, 초기 상한은 **2GiB**로 제안한다. 이 상한은 조사 결과에 따른 구현자 제안이며 이번 승인 대상이다.
- 도구는 `D:/build/toolchains/sccache/0.19.0` 한 곳에 설치한다. 기존 pnpm/Cargo/Gradle/SDK 캐시가 있으면 재사용하고 새로운 전체 환경 사본은 만들지 않는다.
- 설정은 저장소에 고정된 도구 버전/무결성 정보와 공통 Git 설정의 로컬 활성화 정보로 분리한다. 시스템 전역 RUSTC_WRAPPER나 다른 저장소의 환경은 바꾸지 않는다. 캐시 상태의 단일 소유자는 새 worktree storage 도구이며 기존 library-data는 라이브러리 바이트의 소유자로 유지한다.
- 기존 `.dist`와 branch target 위치는 바꾸지 않는다. 별도 작업용 build 폴더를 매번 만들지 않고 기존 고정 경로나 새 검증 도구의 고정 `build-native/cache-probe`만 사용한다.

## Rust/C++ 컴파일 캐시

Mozilla 공식 sccache **v0.19.0**을 고정한다. 2026-10-24 공개된 Windows x86-64 ZIP은 9,830,245 bytes이며 공식 release asset digest는 `28be8c61f6b2c89b9eb2869f6af7f78e6f992e78a8abae0ce855fcc129cbeac1`이다. 설치 시 archive digest와 실행 버전을 검증한다. Cargo로 sccache 자체를 새로 컴파일하지 않는다.

- Rust는 `RUSTC_WRAPPER`, CMake의 네이티브 C++은 compiler launcher로 연결한다. Emscripten은 em++ 자체를 다른 컴파일러로 가장하지 않고 `EM_COMPILER_WRAPPER`를 통해 내부 Clang에 연결한다.
- 컴파일러, target/ABI, profile, 소스·헤더, 옵션과 필요한 환경값을 포함하는 도구의 캐시 키를 유지한다. 서로 다른 Windows GNU/MSVC, Android ABI 및 WASM 결과를 하나로 취급하지 않는다.
- `SCCACHE_BASEDIRS` 등의 경로 정규화는 branch 경로·dep-info·`__FILE__`/Rust `file!()`·`env!()` 결과를 바꾸지 않는 프로브에서 확인된 설정만 사용한다. 의미가 달라지면 적중률을 위해 키를 약화하지 않는다.
- 개발 중인 workspace crate의 incremental 상태는 유지한다. sccache가 지원하는 비증분 의존성 컴파일을 공유하고, incremental crate 및 최종 링크 등 비캐시 대상은 도구 통계에 따로 기록한다. 전역 `CARGO_INCREMENTAL=0`으로 기존 증분 캐시를 폐기하지 않는다.
- 기존 dev.ps1, build-android.ps1, native test/package 명령과 루트 CMake preset 경로에 연결한다. 직접 명령을 실행하는 경우에도 쓸 수 있는 저장소 범위 `--with-compiler-cache -- <command>` 진입점을 제공한다. bare 명령의 임의 실행까지 자동으로 가로챈다고 주장하지 않는다.
- 다른 RUSTC_WRAPPER/launcher 또는 다른 도구 서버가 설정돼 있으면 덮어쓰거나 종료하지 않고 충돌을 알린다. Pando 전용 loopback 서버 설정과 소유권을 확인한다. 포트의 구체 값은 사용 여부를 조사한 뒤 구현자가 고정한다.
- 이 호스트에서 활성화된 캐시에 도구/무결성/서버 문제가 있으면 명확히 실패한다. 활성화하지 않은 CI/다른 호스트에는 로컬 절대 경로를 강요하지 않는다. 해당 상태는 로그로 구분한다.
- 캐시 적중은 컴파일러의 결정성 또는 기존 WASM 재현 빌드 CI 문제를 해결했다는 증거로 사용하지 않는다.

공식 근거: [sccache v0.19.0](https://github.com/mozilla/sccache/releases/tag/v0.19.0), [sccache 사용과 제약](https://github.com/mozilla/sccache/blob/v0.19.0/README.md), [Rust cache 제약](https://github.com/mozilla/sccache/blob/v0.19.0/docs/Rust.md), [Cargo incremental 범위](https://doc.rust-lang.org/cargo/reference/profiles.html#incremental), [Emscripten compiler wrapper](https://emscripten.org/docs/compiling/Building-Projects.html).

## 활성 staging과 의존성 공유

App staging의 canonical owner는 `apps/web-shell/stage.mjs`이다. 그 소유자가 입력을 안정적으로 읽고 hash를 확인한 뒤, 검증된 불변 파일만 공용 저장소에 넣는다. 라이브러리 소유 파일은 library-data의 명시적인 읽기 전용 view 계약을 통해 재사용한다. 외부 staging 목적지는 App이 소유한 경로인지 확인해야 하며 임의 목적지 링크 API로 만들지 않는다.

기존 staging을 교체하거나 삭제할 때 공유 파일의 쓰기 속성이 다른 view에 남지 않도록 처리한다. 편집·생성 작업은 지정 범위의 독립 파일과 write lease를 받아 수행한다. 공유 파일에 대한 직접 쓰기는 실패하며, 한 브랜치의 수정이 다른 브랜치로 전파되지 않는다. 중앙 라이브러리의 수정 중인 `.edits` 파일을 App view와 하드링크하지 않는다.

pnpm은 기존 store와 lockfile 기반 설치를 유지한다. package별 실제 링크 상태를 확인하고, pnpm이 지원하는 import/dedupe 범위에서 재사용한다. lockfile 버전이나 패키지를 업그레이드해 중복 수치를 줄이지 않는다. 별도 브랜치의 node_modules 디렉터리 전체를 공유하는 기존 junction이 있으면 각 lockfile/설치 소유권에 맞는 view로 정리한다.

## 실제 정리와 복구

기존 `cleanup-reference-analysis-caches.ps1`의 소유권/프로세스 보호 규칙을 확장해 worktree storage preview/apply 모드를 제공한다. 정리 로직을 별개의 비슷한 스크립트로 중복 구현하지 않는다.

1. 적용 직전에 branch/WIP, pin, mount, 실행 앱·서버·빌더, writer lease 및 파일 hash/ID를 다시 조사한다. 조사 이후 바뀐 파일을 과거 목록으로 지우지 않는다.
2. 같은 드라이브에서 이동·공유 view를 준비하고 크기·SHA-256·읽기 전용·실제 링크 ID를 검증한 뒤 소비 경로를 전환한다.
3. journal은 각 단계의 원래 위치와 속성, 검증 상태를 원자적으로 기록한다. 중단 후 재개 또는 전환 전 위치 복구가 가능해야 한다.
4. 현재 consumer가 없고 중앙 정본/로컬 Git 객체로 정확히 복구되거나, 생성 소스·현재 재생성 경로가 검증된 사본만 제거한다. 원격 재다운로드, 오래된 이름, ignored 여부만으로 삭제하지 않는다.
5. 고유 원본·증거·미보관 변경은 canonical 라이브러리의 적절한 원본/비공개 증거 경로로 실제 이동하며 출처를 유지한다. 평가 결과를 재생성 캐시로 분류하지 않는다.
6. 다른 작업이 사용하는 lease/빌드/서버를 제거하거나 종료하지 않는다. 위험한 해당 대상만 건너뛰고 이유·용량·현재 consumer를 기록한다.
7. 사용 종료된 자체 검증 파일·다운로드·journal·빈 과거 폴더를 제거한다. 새 전체 repo/data/build 백업은 만들지 않는다.

캐시 공유 도구는 준비·정리·새로 활성화한 컴파일 캐시의 설정만 소유한다. 기존 모델/앱 상태나 library-data의 자료 pin을 두 번째 상태로 복제하지 않는다.

## 검증과 공간 예산

집중 단위검사는 경로 탈출·junction, hash 불일치, 활성 consumer, 직접 쓰기 차단, 독립 편집, readonly 복원, journal 중단/재개 및 stale 조사 목록을 다룬다. App의 실제 staging·개발 서버 읽기와 다른 branch의 읽기를 확인한다. 전체 프로젝트 검사나 설치 패키지는 만들지 않는다.

서로 다른 기존 작업트리 두 곳에서 작은 실제 C++/Rust library 프로브를 컴파일해 첫 miss/반복 및 다른 root의 hit를 확인하고 실행 결과·dep-info를 검사한다. 소스·헤더·옵션/target 변경 시 필요한 miss와 결과 변경도 확인한다. 캐시 불가 단계는 성공 hit로 계산하지 않는다. 검증 후 해당 작은 생성물은 삭제하고 숫자·hash·로그만 남긴다.

새 컴파일 캐시의 상한 2GiB, 도구·임시 파일과 App 전용 불변 pool 초기 준비를 합쳐 **최대 추가 3GiB**를 초기 운영 예산으로 잡는다. 실제 적용 전 재사용 가능한 내용과 정확한 peak를 다시 계산하며 peak + 5GiB headroom을 요구한다. 2026-10-25 조사 시 D: 여유는 약 28.8GB였다. 조건을 충족하지 못하면 배치를 줄이거나 검증된 미사용 파일부터 정리한다.

완료 보고서는 `reports/development/storage/permanent-worktree-cache-20261025`로 한정해 canonical publisher와 fresh check로 원격 보관한다. 이동 위치, 삭제 대상·논리 bytes, 파일 ID 기준 중복 감소, 드라이브 여유 변화, 남긴 큰 캐시의 실제 consumer를 구분한다. 목록/코드 작성만으로 완료하지 않는다. 구현은 clean한 상설 `work/objects`에서 진행하고 다른 채팅의 UI 작업은 보존한다. 새 main 통합·배포는 이 설계 승인에 묶어 암묵적으로 수행하지 않는다.

## 구현자가 정할 수 있는 사항

위 불변식과 예산을 지키는 내부 함수명, journal 세부 필드, 테스트 fixture 이름, 프로브용 작은 계산, Pando 전용 서버의 사용하지 않는 고정 포트는 구현자가 정한다. 삭제 대상의 최신 hash/consumer 판정과 검증되지 않은 절감량은 실행 직전에 결정한다. 새 저장 방식·도구·범위 확대나 증분 빌드 포기는 이 재량에 포함되지 않는다.
