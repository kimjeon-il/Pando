# 지형 전환 지연 수정의 main 반영과 웹·앱 게시 검증

> 보고서 ID: `UI-TERRAIN-RELEASE-20261021` · 상태: `pages-live-verified / windows-native-verified` · 지도 반영: `not-applicable` · 색인일: 2026-10-21
> 조사 기준: 수정 `58fd902849e95ae26b089d978e7be8f7abaa22bc`, 웹 게시 소스 `432993deb1b974fffb27c6816930284dba283850`, 앱 빌드 명령 수정 `5fa4e2c435088aafd900475b53cf8e536b9c0140`
> 근거: `D:/Codex/evidence/terrain-release-20261021-432993de/`, main의 `.superpowers/sdd/terrain-release-20261021/` 및 UI 워크트리의 같은 이름 실행 로그

## 대상과 통합

사용자가 승인한 지형 전환 지연 수정만 main에 fast-forward했다. 원격 main이 `a5f3208c`인 것을 fetch로 확인한 뒤 수정과 자산 버전 커밋 두 개를 반영·push했다. 자산 ID는 **`0.36.0-build-58fd902849e9`**, data revision은 기존 `data-a5bfe87f5918aef45488cd5a4f8dbe1d`이다. 원격 UI의 다른 두 커밋, UI의 테스트 874개 삭제·자동 생성 권한 설명·미추적 파일, main의 기존 annex 스크린샷은 보존했다.

기존 수정 방향과 원인·전후 측정 한계는 [UI-TERRAIN-LATENCY-20261021](terrain-interaction-latency-2026-10-21.md)에 있다. 최초 영역의 네트워크 다운로드를 없앴다는 주장은 하지 않는다.

## main에서의 관련 검사

- 지형 소유자·공유 스케줄러·리소스 수명·새 회귀: **44/44 통과**.
- 변경한 공유 스케줄러 계약의 별도 집중 검사: **1/1 통과**.
- WebGL1·2 기존 셰이더 픽셀 회귀와 새 실제 브라우저 회귀: **16/16 통과**. 데스크톱과 모바일 레이아웃, 평면의 작은 확대, 입력 유지 중 상세 프레임 완료를 포함한다.
- Windows 내장 프로토콜 빌드 명령의 회귀 검사: **1/1 통과**. 아래 앱의 빈 화면 재현 후 추가했다.

이 검사는 main의 현재 테스트 파일을 직접 실행했다. 이전 UI 워크트리의 테스트 삭제 때문에 사용했던 임시 실행본과 구분한다. 전체 테스트나 C++/WASM CI를 통과했다고 보고하지 않는다. 기존 별도 실패는 앞 보고서의 범위를 유지한다.

## 웹 게시와 실제 사이트

[Web Pages 실행 39449108899](https://github.com/kimjeon-il/Pando/actions/runs/39449108899)는 게시 소스 `432993de`에서 build·deploy 모두 성공했다. 로컬과 CI의 공개 파일 **1,400개, 133,378,804바이트**에 대해 경로·SHA-256·크기가 모두 일치했다. 변경된 공개 파일 6개는 [실제 사이트](https://kimjeon-il.github.io/Pando/)에서 HTTP 200과 게시 파일 SHA-256 일치를 확인했다. 나머지 파일은 CI/로컬 manifest 비교이며 모든 파일을 실사이트에서 다시 다운로드한 것은 아니다.

Windows Chromium/D3D11의 실제 배포 WebGL2, 실제 ETOPO CDN으로 다음을 확인했다. 페이지 오류는 0개다.

| 조작 | 화면 배율 S | 실제 지형 단계 | 상세 음영 | 실제 프레임 준비 |
| --- | ---: | ---: | --- | --- |
| 지구본 확대 | 4800 | L5 | 사용 | 완료 |
| 평면 축소 | 450 | L2 | 저배율 사전 계산 | 완료 |
| 평면 전환 구간 | 620 | L2 | 저배율 유지 | 완료 |
| 평면 고배율 진입 | 650 | L2 | 사용 | 완료 |
| 평면 해상도 경계 전 | 3000 | L4 | 사용 | 완료 |
| 포인터를 누른 상태의 작은 확대 | 3200 | L5 | 사용 | 완료 |

고배율 세 구간은 실제 지형 셰이더 draw에서 상세 음영 uniform도 확인했다. 원시 결과는 `live-result.json`, 화면은 `live-flat-detail.png`다. 이 검증은 실제 사용자 기기의 체감 평가나 모바일 실기기 검증이 아니다.

## Windows 앱

main의 게시 소스에서 full-world 자산을 staging했다. **1,720개 파일, 173,925,901바이트, source entities 258개**다. UI 워크트리의 미추적 산출물이 실행 파일에 섞이지 않도록 main의 전용 생성 폴더에서 준비한 자산을 UI의 staging 폴더에 그대로 복사했다. 이전 UI staging은 별도 ignored 폴더에 보존했다. 복사는 실제 Rust 라이브러리 컴파일 시작 전에 끝났으며 두 staging 증거 파일의 SHA-256도 일치한다. Rust 컴파일은 기존 UI 워크트리의 빌드 캐시를 재사용한다. 저장소의 Cargo.lock과 고정 의존성은 변경하지 않았다.

첫 Windows GNU dev 빌드는 15분 9초 후 성공했지만, 일반 실행기로 연 WebView가 빈 화면에 머물렀다. 내장 URL의 `index.html`은 `asset not found`로 500을 반환했다. 실제 Cargo fingerprint에서 루트 crate의 feature가 비어 있어 내장 자산이 포함되지 않은 것이 확인됐다. 이 실행은 성공으로 판정하지 않는다.

기존 `build:windows` 명령에 `--features custom-protocol`을 명시하는 수정 `5fa4e2c4`를 main에 반영·push했다. 해당 옵션 누락을 검출하는 회귀 검사를 실패부터 재현한 후 수정본과 main에서 통과시켰다. 수정 빌드의 Cargo와 rustc 명령에서 루트 feature 적용도 확인했다. 웹 자산에는 변동이 없어 Pages를 다시 배포하지 않았다.

수정한 Windows GNU dev 빌드는 **9분 57초**, 종료 코드 0으로 완료했다. 기존 `storage.rs:86`의 `unused_mut` 경고 한 건은 그대로이며 이번 변경과 무관하다. 다음 두 파일을 main의 기존 실행 경로로 교체하고 원본·임시 복사본·최종 파일의 SHA-256 일치를 확인했다.

| 파일 | 바이트 | SHA-256 |
| --- | ---: | --- |
| `pandolab-web-shell.exe` | 370,047,780 | `0A5DBF0CFD84F695C9DCA85D3078025E65722A597D1D2BA721DA6009D2DAE4E4` |
| `WebView2Loader.dll` | 160,880 | `86545B66CDB0603BC26B626FB9AD610CB6E71F28D468F5EA66DF23B03DDA96D5` |

실행기는 기존 `D:/dev/PandoLab/apps/web-shell/run-windows.bat`이며 EXE는 그 아래 `src-tauri/target/x86_64-pc-windows-gnu/debug/`에 있다. 별도 포터블 묶음은 만들지 않았다.

기존 실행기로 연 정상 WebView2 창이 내장 `index.html`을 스스로 열었고, 그 뒤 진단 모드에서 다음을 실제 확인했다.

- 자산 build ID `0.36.0-build-58fd902849e9`와 내장 변경 자산 5개의 staging 대비 SHA-256 일치.
- full-world 검사 전체 PASS: source 258개, model 254개, sovereign root 207개, 정밀 형상·정밀 메시·공유 Core·데이터 Worker 준비 완료. blocked requests 0개.
- 실제 WebGL2, 정밀 메시 삼각형 1,501,543개, 활성 WebGL context 1개. 이 한 번의 진단 재로딩에서 정밀 준비 완료까지 약 26.2초이며 보편적인 기동 시간 보장이 아니다.
- 데스크톱 1440×900과 모바일 레이아웃 390×844에서 각각 S 700 → 500 → 700의 여섯 프레임 모두 정밀 메시·화면 준비 완료, low/high 구간 표시 정상.
- 페이지 오류 0개. `native-result.json`, `native-desktop.png`, `native-copy.json`에 결과와 화면·파일 근거를 남겼다. 검사용으로 연 앱 인스턴스는 종료했다.

**앱 편집기의 지형 capability는 현재 비활성화돼 있다.** 위 앱 검사는 정상 기동·벡터 경계·공유 렌더러·내장 자산 검증이다. 앱에서 지형 다운로드나 상세 음영 전환 속도까지 검증했다고 해석하면 안 된다. 해당 지형 검증은 위 실제 웹 검사와 브라우저 회귀의 범위다.

## 검증 범위와 판본

main push, Pages workflow, 로컬/CI 게시 파일, 실제 웹 동작, Windows 실행 파일 교체·정상 실행은 각각 위 근거로 확인했다. 웹의 배포 커밋은 `432993de`, 이후 앱 빌드 명령 커밋은 `5fa4e2c4`이며 웹 자산 build ID는 동일하다. Android·모바일 실기기와 실제 사용자 사용성 평가는 수행하지 않았다.

이 보고서는 `UI-TERRAIN-LATENCY-20261021`의 게시 후속 판본이다. 앞 보고서의 당시 미게시·앱 미검증 상태를 소급해 통과로 고치지 않는다. 지도 형상·역사 GIS의 정확도 검증이나 자료 변경은 수행하지 않았다.
