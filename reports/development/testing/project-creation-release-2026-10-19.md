# 프로젝트 생성·공통 보기 변경 커밋과 Pages 배포

> 보고서 ID: `UI-PROJECT-RELEASE-20261019` · 상태: `published / focused-verified / android-device-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-19  
> 제품 소스: `ce2db90932b44c344c2f0d2d9bd697a630b7ba3c` · 생성 결과: `018b2a9e0a5101064a037fe0e11605c5be8563cc`  
> 원본·출처: [구조화된 검증 기록](project-creation-release-2026-10-19.evidence.json), `.superpowers/sdd/2026-10-19-project-release/`

## 대상과 기준

사용자의 커밋·푸시·배포 지시에 따라 이전 [구현 보고서](project-creation-storage-2026-10-19.md)의 변경을 게시했다. 새 프로젝트 생성 통합·독립 설정 창 제거·보기 상태 저장 분리와 앞서 승인한 편집 집중·표시 통합 작업을 포함한다. 분포도 기능과 저장은 유지한다.

`work/ui` 상설 워크트리에서 누적 변경을 `e31b9fe6`으로 커밋했다. 원격 main의 참조 이미지 기능을 먼저 합치고 원격 work/ui의 생성 결과도 보존했다. 공통 입력 처리의 원격 개선과 생성 창·편집 취소 처리를 함께 유지했다. 생성 HTML·CSS·import map은 정본에서 재생성했다. 강제 푸시·stash·reset·clean을 사용하지 않았고, 로컬 추적 로그·별도 테스트 결과·자동 생성된 Tauri 권한 설명 변경과 main의 미추적 이미지는 포함하거나 삭제하지 않았다.

## 검증과 게시

- 커밋 전 관련 문서·파일·자동저장·생성·제품별 staging 검사 **64/64**, 원격 병합 후 **64/64**를 통과했다. 별도 참조 이미지 입력·UI 검사 **25/25**와 생성·취소·오류·기간·기기별 보기 복원·파일 열기 브라우저 **6/6**을 통과했다.
- 원격 CI에서 드러난 schema11 고정 assertion을 현재 schema14로 바꾸고, 버전 검사의 별도 `app-*` 금지 규칙을 기존 제품 자산 분류자와 공유하도록 수정했다. 공통 `app-accent`·`app-map-settings` 허용과 편집 시작점·편집 Worker 차단은 그대로 검사한다. 관련 **9/9**, 버전 검사, 변경 JS ESLint가 통과했다.
- [P1 scoped CI](https://github.com/kimjeon-il/Pando/actions/runs/39218115082), [P3 Web 검증](https://github.com/kimjeon-il/Pando/actions/runs/39218115117), [P2 생성 검증·게시](https://github.com/kimjeon-il/Pando/actions/runs/39218115076)가 성공했다. 전체 테스트 스위트 성공을 의미하지 않는다. 기존 테스트 오류 9건은 구현 보고서에 남아 있다.
- Windows full-world debug/no-bundle 빌드와 실제 WebView **12/12** 검사가 통과했다. canonical-ready, 원본 국가 258·현재 객체 254·최상위 일반 객체 207, Core·렌더러·mesh·geometry·Worker·오프라인 요청 차단을 확인했다. 바이너리는 고정 경로 `apps/web-shell/src-tauri/target/x86_64-pc-windows-gnu/debug/pandolab-web-shell.exe`에 있다.
- `main`에 ff-only로 반영하고 푸시한 제품 소스 `ce2db909`의 [Pages 배포](https://github.com/kimjeon-il/Pando/actions/runs/39218339453)가 성공했다. [공개 사이트](https://kimjeon-il.github.io/Pando/)가 HTTP 200으로 응답했다. CI가 포장한 **1,315개·108,668,278바이트**의 파일 SHA가 로컬 staging과 전부 같고 앱 소스 104개·공통 C++ 소스 173개가 제외됐다.
- 공개 사이트의 HTML·공통 모듈·현재 schema·읽기 전용 Worker·WASM·스타일·역사 지도 manifest 등 **13개**를 직접 내려받아 SHA-256이 일치함을 확인했다. Canvas 모드의 **1280×800·640×360**에서 지도 준비 완료, 편집 생성/설정 버튼 및 확대 버튼 부재를 확인했다. PC에서 환경설정 열기·닫기, 프랑스 검색 결과·선택 상태를 실제로 확인했으며 페이지 예외·누락 응답은 0건이었다. 이 결과를 기본 GPU 경로의 성능 측정이나 모든 화면 픽셀 검증으로 확대하지 않는다.

## 생성 산출물 동기화와 최종 판본

P2가 동일 제품 소스의 최신 생성 결과를 `018b2a9e`에 게시했다. 바뀐 7개 파일은 제품 HTML·빌드 메타데이터·생성 provenance·지도 manifest·압축 프로젝트다. 역사 프로젝트를 풀어 비교한 **18,092,583바이트 전체가 동일**하다(SHA-256 `8990e50542079020e8ebc34e6792f994dfdf8b314b3717319d5900cf14cd3bcd`). 생성된 준비 mesh의 알고리즘 출처도 현재 Core source SHA `18b9265509c33f107e0915cd5830cd54387c8ae07df3374a15d15cc958b338fb`와 일치한다. 산출물 반영 후 버전·생성 메타데이터·관련 9개 검사도 통과했다.

이 생성 결과와 본 보고서를 마지막으로 main에 반영해 게시한다. 최종 보고 커밋의 자기 SHA는 본문에 순환해서 넣지 않으며, 마지막 Pages workflow의 `headSha`·성공 상태는 실행 기록 `final-pages-verified.json`, 실제 게시 파일 검사는 `final-live-hashes.json`에서 구분한다. 최초 공개 UI 검사 이후 제품 동작 코드를 바꾸지 않았고, 최종 게시 산출물의 해시를 별도로 확인한다.

Windows 실행 파일의 embedded source는 `aa3c9af9`다. 뒤의 CI 검사·생성 provenance·압축 컨테이너·보고 변경을 같은 실행 파일 재빌드로 주장하지 않는다. UI·공통 Core·압축 해제 후 지도 내용은 같으며, Windows 실행 검증과 마지막 웹 바이트 검증은 서로 다른 증거다. Android 실기기, APK·설치 프로그램 게시, 전체 CI·전체 테스트 통과는 검증·수행하지 않았다. 휴대용 ZIP은 만들지 않았다.
