# 앱 평면 편집 변경 게시와 작업 브랜치 전파

> 보고서 ID: `UI-EDITOR-FLAT-RELEASE-20261020` · 상태: `pages-live-verified / branches-propagated / windows-native-verified / android-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-20
>
> 원문 최종 수정: 2026-10-20 · 구현 `2e69c790ecdfce190089c78919801642bc168cad` · 최초 게시 원본 `f70c940380eadbbc357f894e82a55d882ee4e52c`
>
> [구현 검증](editor-flat-cleanup-2026-10-20.md) · [게시 검증 근거](editor-flat-release-2026-10-20.evidence.json)

## 대상과 실행 범위

사용자의 커밋·push·배포·다른 작업 브랜치 전파 요청에 따라 앱 평면 편집 변경을 게시했다. 앱의 지구본·그림자·경위선 제거와 웹 열람 기능 유지를 포함한다. 이전 미커밋 Tauri 권한·줄바꿈·실험 코드·보고서·미추적 자료를 작업 커밋에 섞지 않았다.

## 커밋과 게시

| 대상 | 확인 내용 |
| --- | --- |
| 구현 | `2e69c790ecdf`에 작업 소유 90개 파일을 커밋했다. |
| 게시 식별자 | `f70c940380ea`에서 구현 커밋의 자산 식별자를 생성했다. 초기 build ID는 `0.36.0-build-2e69c790ecdf`다. |
| 원격 생성물 보존 | 검증된 생성 봇의 `ff33addd3bb7683cae135ab489b99576bb2484be`를 가져왔다. HTML·메타데이터와 P2 생성 manifest만 갱신했으며 data revision과 Worker 내용 해시는 유지된다. 최신 build ID는 `0.36.0-build-f70c940380ea`다. |
| 최초 Pages 배포 | [39357732382](https://github.com/kimjeon-il/Pando/actions/runs/39357732382)의 build·deploy가 `f70c940380ea`에서 모두 성공했다. |
| 최종 Pages 배포 | 생성 봇 원본 `ff33addd3bb7`을 [39358510182](https://github.com/kimjeon-il/Pando/actions/runs/39358510182)에서 게시했다. build·deploy가 모두 성공했다. |
| 게시 파일 정합성 | 실제 커밋만 사용하는 Pages staging에서 1,399개 / 133,360,772 bytes를 확인했다. 공통 C++ 소스 173개와 앱 소스 104개는 게시에서 제외된다. |
| 공개 자산 | 공개 HTML·메타데이터·변경된 공통 모듈·웹 staging에 포함된 모든 Worker 의존성, 합계 95개 HTTP 응답을 staging SHA-256과 대조해 모두 일치했다. |
| 공개 실행 | Microsoft Edge 1280×800, 실제 `canvas-worker`에서 지도 준비 완료, 웹 경위선·그림자 설정, 평면 투영 전환·시점 이동을 확인했다. 문서 snapshot·checkpoint 불변, dirty=false, pageerror 0이었다. |

최초·최종 배포 각각 실제 공개 자산 95개를 해당 CI staging과 대조했고, Edge에서 각 build ID로 실행되는 것을 확인했다. 두 배포 SHA를 구분한다. 이 보고서만 추가하는 후속 커밋은 게시 원본을 바꾸지 않도록 `[skip ci]`로 기록하며 제품 코드 검증을 생략하는 용도로 사용하지 않는다. 사용자 개인 탭의 기존 캐시를 직접 검사한 결과도 아니다.

## 관련 검사

- 커밋 전 관련 단위 48/48, 작성 JS/MJS 67개 파일 lint, 생성물 `--check`, diff 공백 검사 통과.
- 편집·저장·실제 파일 재열기, 데스크톱/휴대폰 앱 시작, 새 프로젝트, 웹 설정 복원 브라우저 5/5 통과.
- main 통합 후 제품 HTML·카메라·초기화 단위 5/5 통과. 생성 봇 통합 후 생성물 `--check`도 통과.
- Windows full-world staging 1,720개 / 173,903,902 bytes / 258 source entities를 검사했다. 앱 편집기 시작점과 내용 해시 Worker 검증이 통과했다.
- 전체 suite를 실행하거나 미실행 CI 작업을 통과로 집계하지 않았다. 로컬 고정 DEM fixture가 없는 기존 Canvas 지연 사례와 Android 실제 기기 검증은 이전 보고서의 미검증 상태를 유지한다.

## 작업 브랜치와 미완성 작업 보존

`work/ui`, `work/objects`, `work/places`는 생성 봇을 포함한 게시 계열을 fast-forward했다. `work/gis`는 원격에 있던 추가 조사 커밋 `310ee5e674c43cc434f154886da254b2038148a4`를 먼저 가져온 뒤 게시 계열을 병합했다. GIS 고유 보고서는 해당 브랜치에 유지하며 이번 요청을 새 GIS 자료의 main 적용으로 해석하지 않았다.

통합 전 원래 파일의 byte hash와 tracked 변경 원본·patch를 보관했다. main 1개, UI의 비작업 파일 1,327개, places 3개는 동일하다. objects 11개 중 10개가 동일하며, `reports/README.md`에는 기존 미커밋 `PERF-PREDICATE-20261018` 행을 그대로 유지하고 새 정본 색인 행을 추가했다. objects의 HEAD 대비 색인 변경은 원래의 1행 추가뿐이다.

겹치는 objects 색인은 백업·정확한 역 patch 확인 후 병합하고 원래 patch를 다시 적용했다. stash·reset·clean·강제 push·상설 워크트리 정리는 하지 않았다. 커밋을 막던 40분 이상 된 빈 UI Git 잠금은 Git 프로세스가 없음을 확인하고 백업 위치로 이동했다.

## Windows와 한계

상설 main 작업 폴더의 GNU debug 실행 파일을 full-world로 증분 빌드했다. 첫 빌드는 새 Rust 의존성을 포함해 19분 8초가 걸렸으며, 최종 게시 자산으로 맞춘 앱 재빌드는 캐시를 사용해 3분 30초에 끝났다. 최종 앱 staging 소스는 `ff33addd3bb7`, build ID는 웹과 동일한 `0.36.0-build-f70c940380ea`다. 기존 `storage.rs:86`의 unused_mut 경고 1건은 관련 없는 코드이므로 변경하지 않았다.

실제 Windows WebView2를 별도 자동 검증 프로필로 실행해 사용자 프로젝트와 분리했다. 실제 MapHost에서 flat 유지, 지구본 명령의 명시적 거절과 카메라 불변, 지구본·그림자·경위선 DOM 부재를 확인했다. 기존 full-world 진단의 자료 수·Core·canonical geometry/mesh·WebGL 렌더러·Worker·차단된 요청 0 등 12개 검사가 전부 통과했다. 실행 파일 SHA-256과 결과는 근거 JSON에 보존한다.

기존 실행 경로는 `apps/web-shell/run-windows.bat`이며, 그 경로가 사용하는 EXE를 갱신했다. ZIP·포터블·새 설치 패키지는 만들지 않았다. 빌드가 자동 생성한 main의 권한 설명 변경은 별도 복사로 보관하고 원래 커밋 내용으로 복원했다. 기존 UI 워크트리의 Tauri 미커밋 변경은 그대로 남겼다.

Android APK 추가 배포·실제 기기 회전 검증은 하지 않았다. 웹·앱 원본 커밋과 배포/실행 증거를 구분하며, 브라우저의 앱 시작점 검사만으로 네이티브 실행 성공을 주장하지 않는다.

별도의 Application Architecture workflow `39357732445`는 기록 시 실행 중이었다. 이 보고서는 그 전체 workflow 성공을 주장하지 않으며, 완료된 Pages 배포와 위 범위의 실제 실행 증거를 구분한다.

## 데이터 반영과 판본

지도 데이터 적용은 `not-applicable`이다. data revision은 `data-a5bfe87f5918aef45488cd5a4f8dbe1d`를 유지한다. 이 보고서는 `UI-EDITOR-FLAT-20261020`의 커밋·게시·브랜치 전파 후속 기록이다.
