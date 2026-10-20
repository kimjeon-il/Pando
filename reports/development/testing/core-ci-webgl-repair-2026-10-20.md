# C++ CI 2건과 Windows WebGL UI 시간 초과 수정

> 보고서 ID: `DEV-CORE-CI-WEBGL-20261020` · 상태: `native-ci-verified / webgl-ui-verified / separate-artifact-ci-failure` · 지도 반영: `not-applicable` · 색인일: 2026-10-20
>
> 원문 최종 수정: 2026-10-20
>
> 조사 기준: main `a5f3208c782728b4540c3072bc784ef55933c1c3` · 수정 `b234955311d11c592d3d3eba78c4a3b1524867f1`

## 대상과 방법

[이전 배포 검증](map-scale-release-2026-10-20.md)에 남긴 C++ 두 실패와 headless WebGL UI 시간 초과를 각각 재현했다. `work/ui`의 기존 테스트 삭제 작업을 보존하고, `work/objects`에서 최신 main과 두 작업 범위를 함께 검증했다. objects의 미완료 보고서 색인 한 행은 원본·patch로 보존한 뒤 최신 색인에 다시 적용했다. 별도 작업을 커밋하지 않았다.

## 원인과 수정

### 네이티브 C++

원래 CI와 같은 `web_content_command_tests`, `web_territorial_command_tests`를 GNU 13.1.0 Release / assertion 활성 상태에서 실행해 두 실패를 그대로 재현했다(`ctest-red.log`). 제품 검증을 완화하지 않고 테스트의 현재 입력 계약을 고쳤다.

- content fixture는 기본 `ProjectDocument.exchangeMetadata`에 이미 들어 있는 `projectSetup`을 출처 baseline에 등록하지 않았다. 일반 객체를 처음 만들면서 비승격 inline geometry 검증이 활성화되어 `missing opaque baseline`으로 거부됐다. 기존 `GeometryProvenanceCodecAccess::admitProjectSetupMetadata`를 통해 fixture를 준비한다. baseline 검증을 생략하거나 임의의 private hash 함수를 노출하지 않았다.
- territorial golden은 현재 `TimelineRecordSchemaVersion=2`와 다른 v1 직렬화를 기대했다. 두 literal을 v2와 명시적 빈 `propertyBindings`로 갱신했다. 기록 ID 충돌, archived geometry v7·증분 v8, 월별 할당, 생성·삭제·원자성·Undo/Redo 검사는 유지했다. 과거 형식 읽기나 별도 호환 경로를 추가하지 않았다.

수정 후 두 검사는 모두 통과했다(`ctest-green.log`). 같은 CI 네이티브 9개 검사도 모두 통과했다(`ctest-contracts.log`, 9/9). GUI 없는 Windows 네이티브 검사이며 Linux 원격 CI와 구분한다.

### Windows headless WebGL

동일 Playwright 1.62.1의 Chromium·1440×900·터치 가능 컨텍스트·동일 URL과 정밀 메시 준비 조건에서 기본 렌더러와 `--use-angle=d3d11`을 비교했다. 기본은 실제 `ANGLE / Vulkan / SwiftShader Device (Subzero)`였다. 메뉴 클릭 10초 제한이 반복해서 만료됐고, capture 단계 pointerdown/up/click은 모두 0개였다. 실패는 메뉴 핸들러 전에 발생했다. CPU 프로파일의 약 15.1초는 `(program)` 구간으로, 긴 JavaScript 메뉴 계산으로 설명되지 않았다. 직접 좌표에 실제 mouse 이벤트를 보내면 메뉴가 열리는 대조 실험도 통과했다. 이 대조 실험을 회귀 검사의 클릭 우회로 사용하지 않았다.

같은 계측 조건에서 D3D11은 `NVIDIA GeForce GTX 1650 / Direct3D11`을 사용했고 기존 `locator.click()`이 정상 처리됐다. 관찰된 원인은 Windows headless의 SwiftShader/Vulkan 경로에서 프레임·UI 안정화/좌표 확인 단계가 지연되는 것이다. 브라우저 네이티브 드라이버 내부의 구체적 결함 위치까지 규명한 것은 아니다. `playwright.config.js`에서 Windows의 ANGLE 백엔드를 D3D11로 지정했다. 제품 렌더러·메뉴·공통 UI 구조는 변경하지 않았다.

기존 보기 메뉴 viewer 검사를 Canvas에서 WebGL로 되돌리고 실제 WebGL2와 정밀 메시 준비를 필수 조건으로 추가했다. 설정 수정 전 같은 테스트의 보기 버튼에서 10초 시간 초과를 재현했다(`browser-webgl-red.log`). 수정 후 editor Canvas·viewer WebGL의 메뉴/하위 메뉴·키보드·모바일 전환·공통 9px 모서리·설정 보존·문서 불변 검사가 2개 통과했다(`browser-webgl-green.log`, 42.7초). 실제 `locator.click()`과 기존 10초 제한을 유지했다. DOM click 대체·force·검사 삭제·제한 시간 확대를 사용하지 않았다.

## 생성물과 원격 검증

공통 C++ 소스 pin은 테스트 소스도 포함한다. 따라서 이번 테스트 변경도 WASM/manifest 재생성이 필요하다. [P2 실행 39438258832](https://github.com/kimjeon-il/Pando/actions/runs/39438258832)에서 기존 소스 일치 생성 절차를 사용한다. 재생성 전 지도·검색 추가 검사 시도는 `Compiled core source identity is stale for this checkout` prerequisite에서 중단됐다(`browser-followup.log`). 실행되지 않은 검사를 통과로 표시하지 않고, pin 검증을 우회하지 않았다.

P2 실행은 성공했다. 생성 결과 `8f5c8c51`(WASM)·`eddca4a4`(연결 생성물)를 fast-forward로 가져왔다. 패키지 검사의 실제 소스 SHA는 `c05f2987d26e0c4f0f167dbab997e7bd32c106a4ca017e576a426f6bd8144ec9`, WASM SHA는 `c83a34a0f634cf609e86f9fe61ed17e9a146315b2db1abd735c0fe1a179eb9b9`다(`wasm-package-check.log`). 기존 JS 바이트는 같고 WASM은 동일 길이 2,975,316바이트이며 컴파일 소스 pin이 갱신됐다. 준비된 폴리곤 manifest는 `algorithmSourceSha256`만 바뀌었고 형상 파일·입력 해시는 변경되지 않았다. 그 밖의 변경은 연결된 생성물 manifest·build metadata·이를 참조하는 HTML이다.

생성 후 WebGL·Canvas 지도 3개와 editor/viewer 검색·IME·가로/세로 전환 4개, 총 7개가 통과했다(`browser-followup-green.log`, 1분 12초). [Linux C++/WASM CI 39439788587](https://github.com/kimjeon-il/Pando/actions/runs/39439788587)를 정확한 생성 결과 `eddca4a44af064958cf217582a55b8067448e7a1`로 실행했다. 같은 생성물에서 메뉴 검사 2개를 다시 실행해 모두 통과했다(`browser-final.log`, 37.9초). Linux CI의 `Build only the small native core, codec and document tests` 단계도 2026-10-20 23:33:40 KST에 success로 종료했다.

후속 CI 전체는 `Verify the compiled source and committed runtime pair`에서 실패했다. 동일 ABI·compiler·source identity 확인 후 실제 WASM 바이트는 P2 게시본 `c83a34a0…`와 CI 재빌드 `657e114f…`가 일치하지 않았다(`linux-failed.log`). 원래 C++ 9개 검사 단계는 success이며 이 추가 실패와 구분한다. P2는 중앙 pin의 CMake 3.31.6과 루트 `pando-wasm` preset을 사용하고, 비교 CI는 Ubuntu 기본 CMake와 `cmake -S shared -B build-native/wasm`을 사용한다. 설정 차이는 확인했으나 이것이 바이트 차이의 전부인지 확인하는 추가 재빌드는 수행하지 않았다. 이 별도 문제로 검사 범위를 더 확장하거나 바이트 검증을 완화하지 않았다. 따라서 CI workflow 전체가 성공했다고 보고하지 않는다.

변경 JS 검사 2개 ESLint와 `git diff --check`는 통과했다. 전체 테스트·독립 역사 형상·실제 휴대전화·Android 검증은 수행하지 않았다.

## 근거와 판본

원시 실패 로그, CPU 프로파일, 프레임/포인터/실제 GPU 기록과 도구 준비 로그는 objects 워크트리의 `.superpowers/sdd/2026-10-20-core-ci-webgl-timeout/`에 보존한다. 기존 테스트 삭제·predicate 비교 실험과 생성 권한 파일은 포함하지 않는다. 지도 데이터 반영은 `not-applicable`이다. 이 문서는 이전 UI 배포 기록의 남은 실패에 대한 후속이며 이전 결과를 소급 변경하지 않는다.

## 반영 범위

수정 소스와 소스 일치 생성물은 `work/objects`에 커밋·푸시했다. main 통합·Pages 배포·Windows 앱 재빌드는 이번 수정에서 수행하지 않았다. 이 보고서·색인은 별도 문서 커밋으로 같은 작업 브랜치에 보관한다.
