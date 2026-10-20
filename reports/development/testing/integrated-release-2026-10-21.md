# 통합 main의 원격 게시와 Windows 실행 파일 갱신

> 보고서 ID: `DEV-INTEGRATED-RELEASE-20261021` · 상태: `pages-live-verified / windows-native-verified / separate-ci-failure` · 지도 반영: `not-applicable` · 색인일: 2026-10-21
> 최종 Web·App 소스: `01bb7eead0dbf947fb0fe305491e477186141fe7` · UI 수정: `389d1bf934c3ff538bd30ca2ce3d6998dbe8333a`
> 빌드 ID: `0.36.0-build-389d1bf934c3` · 자료: `data-7bc7903eb13f89dd317166807b636446`
> 근거: `D:/Codex/evidence/integrated-release-20261021-c082b63a/`, main의 `.superpowers/sdd/integrated-release-20261021/`. 근거 폴더 이름은 최초 게시 커밋이며, `-final` 파일과 마지막 `native-result.json`은 위 최종 소스다.

## 게시 대상과 추가 수정

사용자 요청에 따라 [DEV-ALL-BRANCH-20261021](all-branch-integration-2026-10-21.md)의 통합 main `c082b63a`를 원격에 일반 push했다. 실제 Windows 검사에서 발견한 모바일 작업 패널 결함을 `389d1bf9`에서 수정하고, 자산·메타데이터 receipt를 `01bb7eea`에서 갱신해 다시 push·게시했다. 최종 Web과 App은 같은 커밋이다. 형상·저장 형식·고정 의존성은 변경하지 않았다.

모바일에서는 작업을 시작한 후 기존 `completeToolStart`가 `closeMobileSheets()`를 호출해 새 고정 작업 패널까지 닫았다. 실제 WebView의 클릭·패널 클래스 변경과 호출 스택으로 확인했다. 기존 workspace 소유자가 고정 작업 패널을 유지하도록 수정했고, 새 상태 관리자나 별도 작업창을 추가하지 않았다.

일반 브라우저의 조기 화면 확인만으로는 비동기 완료 뒤 닫히는 순서가 가려졌다. 기존 브라우저 검사에 실제 presentation 소유자의 늦은 완료 순서를 노출하는 검사 경계만 추가했다. 수정 전 패널 닫힘으로 실패했고 수정 후 통과했다. 관련 단위 검사 **8/8**, 새 브라우저 회귀 **1/1**, 변경 JS·검사의 ESLint와 diff 검사도 통과했다. 전체 로컬 회귀는 실행하지 않았다.

검사 카탈로그에는 새 지도 표시 연속성 검사를 등록하고, 폐기된 `projection-border.spec.mjs` 참조를 제거했다. `run-application-checks --list`가 통과했다. 이전 투영 UI나 삭제된 검사를 복구하지 않았다. 메타데이터 생성·검증 뒤 기존 그래프의 build-metadata receipt만 갱신했고, 비수동 artifact family의 지문이 모두 일치했다. 지도 자료를 다시 생성한 것은 아니다.

## Web 게시와 실사이트

최초 [Pages 실행 39502497639](https://github.com/kimjeon-il/Pando/actions/runs/39502497639)는 `c082b63a`에서 성공했다. 당시 공개 파일 1,400개와 변경 파일 30개의 실사이트 바이트를 확인한 근거는 초기 파일에 남아 있다.

최종 [Pages 실행 39510219038](https://github.com/kimjeon-il/Pando/actions/runs/39510219038)는 `01bb7eea`에서 build·deploy 모두 성공했다. deployment `7212882492`도 같은 SHA에서 `success`였다.

- 게시 파일 **1,400개·133,376,661바이트**: CI manifest, 현재 Git tree의 blob·크기, 로컬 SHA-256, canonical viewer 의존성 closure가 모두 일치했다. CRLF 정규화는 실제 Git blob과 일치할 때만 인정했다.
- 최초 게시 이후 변경된 공개 파일 **3개**는 [실제 사이트](https://kimjeon-il.github.io/Pando/)에서 HTTP 200·SHA-256 일치를 확인했다. 모든 공개 파일을 실사이트에서 다시 다운로드한 것은 아니다.
- Windows Chromium/D3D11에서 새 build ID, 지구본 전용 정책, 투영 전환 UI 제거, 명시적 평면 전환 거부를 확인했다. 소스 응답을 바꾸는 route override는 사용하지 않았다.
- 데스크톱 `S=469.7875`의 저배율 준비 완료, `S=700`의 상세 음영·현재 화면 준비 완료, 390×844 모바일 레이아웃의 회전과 초기화 후 지구본 유지를 확인했다. 페이지 오류 **0건**이다.

근거는 `ci-final/pages-evidence.json`, `pages-evidence-final.json`, `live-parity-final.json`, `live-result-final.json`, `live-desktop-final.png`, `live-mobile-final.png`다.

## Windows 빌드 환경

공식 `build:windows`의 debug·GNU x64·`custom-protocol` 옵션과 `PANDOLAB_SHELL_PROFILE=full-world`를 사용했다. 소스·staging은 main이며, 기존 UI Cargo 캐시는 원본을 보존하고 `C:/Users/taeeu/AppData/Local/PandoLab/build-cache/main-cargo-gnu`로 복사해 재사용했다. 새 브랜치·워크트리·포터블 묶음은 만들지 않았다.

D: 빌드는 `could not exec the linker`와 Windows `os error 483`으로 실패했다. 긴 인수도 조사했으나 짧은 링크 명령에서도 오류가 반복돼 해당 가설과 임시 codegen 옵션은 폐기했다. 작은 Rust 프로그램은 오류 뒤에도 정상 실행 가능한 EXE를 만들었다. 설치된 Rust의 [동일 리비전 원본](https://github.com/rust-lang/rust/blob/58cf8f9c35b355199727627d07ae34a4e2846d67/compiler/rustc_codegen_ssa/src/back/link.rs#L2165-L2185)은 링크 성공 후 Windows `sync_all()` 실패도 이 호출의 오류로 반환한다.

별도 작은 파일 동기화가 D:의 build·evidence 경로에서는 실패하고 C: 임시 경로에서는 성공했다. 같은 Rust 프로그램도 C: 출력에서는 빌드·실행 모두 종료 코드 0이었다. 최종 빌드는 C:에서 기본 옵션 그대로 **Cargo 3분 33초·종료 코드 0**으로 완료했다. 앞선 실패·캐시 복사 시간과 별개다. Cargo home의 SQLite last-use 기록 경고와 기존 `storage.rs`의 unused_mut 경고는 로그에 남았다. 물리 디스크 고장 여부를 진단하거나 수정한 것은 아니다.

## Windows 실행 파일과 실제 WebView

최종 staging은 **1,720개 파일·173,869,134바이트·원본 국가 258개**다. source revision은 `01bb7eea`이며, 생성 시점의 미커밋 추적 변경은 payload 밖의 보고서 색인뿐이었다. 빌드 후 생성 권한 설명 6건은 별도로 보존하고 원래 추적 내용으로 복구했다. `native-source-proof-final.json`에서 제품 소스 변경 없음과 staging 당시 diff 지문을 확인했다.

| 파일 | 바이트 | 최종 SHA-256 |
| --- | ---: | --- |
| `pandolab-web-shell.exe` | 370,272,548 | `532610A125C7141E45BCEA3E9BC36A6EDD10EC22FE482EDBBF0123D48BB8DCF4` |
| `WebView2Loader.dll` | 160,880 | `86545B66CDB0603BC26B626FB9AD610CB6E71F28D468F5EA66DF23B03DDA96D5` |

EXE를 기존 `D:/dev/PandoLab/apps/web-shell/src-tauri/target/x86_64-pc-windows-gnu/debug/`에 교체하고 원본·임시 복사본·최종 파일의 해시 일치를 확인했다. DLL은 기존 바이트가 이미 같아 유지했다. 실행기는 기존 `D:/dev/PandoLab/apps/web-shell/run-windows.bat`이다.

기존 실행기로 연 **재빌드한 EXE의 내장 자산**을 사용했다. JavaScript 소스 override는 하지 않았다. 정상 진입 `http://tauri.localhost/`에서 새 build ID와 enhanced readiness를 확인한 뒤 진단 재로딩을 수행했다.

- full-world 12항목 전체 PASS: source 258개, model 254개, sovereign root 207개, 정밀 형상·메시·공유 Core·data Worker, 차단 요청 0개.
- 실제 WebGL2, 삼각형 **1,501,543개**, 활성 WebGL context **1개**.
- **JS/WASM 8개**의 실제 내장 응답과 staging SHA-256 일치. HTML은 Tauri 직렬화로 원시 바이트가 달라져, 파싱한 전체 head·body·HTML 속성의 정확한 일치를 확인했다.
- 검사 소유 프로세스의 실제 Windows 호스트 창을 조절했다. **1440×900·390×844**에서 측정한 CSS viewport가 각각 정확히 일치했다. 두 폭 모두 영토 편입 시작 완료 뒤 패널 유지, 접기·펼치기·취소가 통과했다.
- 각 폭에서 `S 700 → 500 → 700`의 **여섯 프레임 모두** canonical mesh·현재 화면 준비 완료와 high/low/high 표시가 정상이다.
- 새 프로젝트 설정 열기·취소를 확인했다. 실제 프로젝트 교체·저장 작업은 이번 native 검사에서 다시 실행하지 않았다.
- 페이지 오류 **0건**. 검사용 앱 프로세스의 종료도 확인했다.

`native-copy.json`, `native-stage-evidence-final.json`, `native-source-proof-final.json`, `native-process.json`, `native-result.json`, `native-desktop.png`, `native-mobile.png`, `native-exit-final.json`에 근거가 있다. 검사용 WebView 프로필은 C: 임시 경로를 사용했으며 native 파일 저장소까지 격리했다는 주장은 하지 않는다. 앱의 terrain capability는 꺼져 있으므로 위 벡터·기동 검사로 앱 지형 다운로드를 검증했다고 해석하면 안 된다.

## 별도 CI와 미검증 범위

Pages·실사이트·Windows 실행 검증을 다른 CI 전체 성공으로 표시하지 않는다. 다음은 **2026-10-21 07:55 KST** 확인 상태다.

- [최종 Application Architecture 39510219049](https://github.com/kimjeon-il/Pando/actions/runs/39510219049): 이전 등록 누락은 수정했고 changes 단계는 성공했다. 전체 checks는 실행 중이었다. 완료·통과로 판정하지 않는다. 초기 실행 `39502497397`의 등록 오류와 구분한다.
- [최종 Shared C++/WASM 39510219047](https://github.com/kimjeon-il/Pando/actions/runs/39510219047): `WASM binary artifact stale`로 실패했다. 게시 WASM `c83a34a0…`와 CI 재빌드 `ca046c8a…`의 바이트 대조 실패다. 초기 실행 `39502497880`의 재빌드 해시는 `1eb0abe7…`였다. 이번 UI 수정에서 이 차이의 원인을 해결하거나 두 바이너리의 의미가 같다고 증명하지 않았다. 로컬 source pin·ABI·게시 파일 해시 검증과 별개다.
- [기존 DEM Terrain Preview Gate 39502497824](https://github.com/kimjeon-il/Pando/actions/runs/39502497824): 3건 중 2건 실패가 남아 있다. WebGL 검사는 현재 viewer가 금지하는 flat projection을 요청하고, Canvas Worker 검사는 상세 타일 0·terrainFailed 상태에서 시간 초과했다. 이번 수정은 이 검사나 Canvas 실패를 고치지 않았고 최종 push에서 해당 workflow를 재실행하지 않았다.

이전 통합 보고서의 단위 39건·브라우저 4건·기존 C++ 바이너리 2건 결과와 이번 검증은 별개의 근거다. Android·모바일 실기기·실제 사용자 사용성 평가, 전체 로컬 회귀는 수행하지 않았다. Windows 390px 창 검증은 Android 검증이 아니다.

## 판본과 보존

이 문서는 통합·초기 지도·웹 지구본 전용 구현 보고서의 게시 후속 기록이다. 앞 문서의 당시 로컬 검증·미게시 상태를 소급해 통과로 바꾸지 않는다. 기존 UI·objects·places의 미완성 소스와 main의 기존 annex 스크린샷을 포함하지 않았고, 상설 워크트리와 캐시는 보존했다. 검증 기록만 추가하는 후속 문서 커밋은 `[skip ci]`로 push하며, 게시·앱 소스는 위 `01bb7eea`로 구분한다.
