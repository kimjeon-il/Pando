# 공통 웹 초기화 및 전체 세계 데이터 패키징 — 2-3A~C

> 보고서 ID: `DEV-080` · 상태: `investigating` · 지도 반영: `not-applicable` · 색인일: 2026-10-16
> 원문 최종 수정: 2026-10-16
> 조사 기준: `work/ui`, 2026-10-16
> 원본·출처: [앱 실행법](../../../apps/web-shell/README.md), [세계 데이터 manifest](../../../assets/data/world/current.json)

## 목적과 구현

2-3A: 전체 세계지도 앱은 `apps/web-shell/startup.js`에서 웹의 `assets/js/bootstrap.js`를 호출한다.
기존 웹 `data-loader-worker.js`가 빠른 미리보기 → 원본 국가 packet → 정본 메시를 로딩한다.
`assets/js/app.js`는 Tauri가 미리 주입한 platform 기능만 선택적으로 넘기고, 웹에서는 기존 기본값 `{}`를 사용한다.
소형 15좌표 검증 프로필은 변형하지 않고 따로 유지한다.

2-3B: `apps/web-shell/stage.mjs`의 `full-world` 프로필은 정본 manifest에서 포함 파일을 자동 산출한다.
정본 258개국용 다섯 메시/국가 자산, 공유 국경선 캐시, 역사 프로젝트, 국가·지역 라이브러리,
미리 계산한 정밀 다각형 메시의 현재 참조 파일만 포함한다.
개별 pin을 가진 파일은 staging 전에 압축 크기와 SHA-256을 대조한다.
전체 세계 패키징 한도는 256 MiB, 소형 시험 한도는 80 MiB로 분리한다.

2-3C: 실행 모드의 `stage-profile.json`과 빌드된 자산 리비전을 일치시키고,
로컬 origin 이외 모든 네트워크 요청을 계속 차단한다.
`full-world` 프로필만 로컬 `assets/data/` 요청을 허용한다.
웹의 기본 역사 자료 공급자를 재사용하며 전체 세계와 시험 데이터의 IndexedDB 이름을 분리한다.
수계·지형·내장 지명은 비활성화된 상태로 유지한다.

## 검증 근거

- 실제 저장소 `assets/data/world/current.json`의 국가 수는 258.
- published metadata + world/historical/library/prepared manifest에서 해석된 대상은 **597개 파일**.
- 실제 GitHub 디렉터리 목록과 비교해 대상 경로(상위 manifest 포함) 존재 여부 및
  제공된 파일 크기의 불일치 **0건**. 선별 데이터 크기는 약 **79.8 MB**
  (GitHub directory metadata 기반이며 실제 앱 패키징 실행 실측 아님).
- 순수 manifest 계획 단위 테스트 2건(경로 폐쇄, 잘못된 pin·원격/상위 경로 거부):
  소스 대상 격리 JavaScript 실행에서 **PASS**.
- Node 공식 단위 테스트 명령, 실제 전체 세계 패키징, Windows/Android Tauri 빌드,
  WebGL 전체 화면·타임라인·대용량 반응성: 아직 **NOT_RUN**.
- 기존 소형 앱 소스·검증 수치는 2-3 이후 재빌드하여 비교해야 함.

## 후속 단계

1. Node 환경에서 `node --test apps/web-shell/tests/world-data-plan.test.mjs apps/web-shell/tests/stage.test.mjs apps/web-shell/tests/network-guard.test.mjs`.
2. `pnpm --dir apps/web-shell stage:world`를 실행하고 `apps/web-shell/dist/shell/stage-evidence.json`의 파일 SHA와 개수를 검사.
3. `PANDOLAB_SHELL_PROFILE=full-world` 환경에서 시험용 Windows 앱을 빌드하여 실제 화면과 역사 자료를 확인.
4. 나머지 물리 데이터·지명 로딩 및 대형 프로젝트 파일 IPC는 2-3D~F, Android 실기기 성능은 2-4.

기존 Qt 앱과 `main` 배포는 수정하지 않음.
