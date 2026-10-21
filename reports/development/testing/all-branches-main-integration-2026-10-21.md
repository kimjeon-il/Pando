# 미병합 커밋 main 통합

> 보고서 ID: `DEV-MAIN-20261021` · 상태: `integrated / focused-verification` · 지도 반영: `not-applicable` · 색인일: 2026-10-21
> 원문 최종 수정: 2026-10-21
> 기준: 기존 main `ab4112e0ec47b552153257986ef83a3a37b89411` 및 이 보고서가 포함된 병합 커밋

## 통합 범위

사용자의 main 미병합 사항 전체 통합 지시에 따라 로컬 및 origin의 모든 작업
브랜치를 확인했다. 미병합 커밋은 아래 3개였으며 나머지 브랜치의 커밋은 이미
기존 main에 포함돼 있었다.

| 커밋 | 반영 내용 |
| --- | --- |
| `5bb4182ce204f3a9acab033542772bffc67f0ac9` | 국가별 내장 지도 로딩, 현재 월 선택, 기존 단일 프로젝트 외부 보관 |
| `979028ba690c4ed1d22dfeed88959106a02527d5` | 참조 이미지의 공통 Surface 구조 및 스타일 소유권 통합 |
| `194d5577ab00cde581a821e35b77d03af40000f8` | UI 변경의 기존 생성 메타데이터 기록 |

`work/gis`는 fast-forward로 반영하고 `origin/work/ui`를 병합했다.
충돌 3개는 `index.html`, `apps/web-shell/editor.html`, `assets/js/build-meta.js`로
모두 생성물이었다. 최종 통합 소스와 기존 국가별 데이터에서 생성기로 다시
만들었으며 단일 프로젝트 로딩이나 이전 메타데이터를 복원하지 않았다.
통합 자산 ID는 `0.36.0-build-all-branches-20261021`이다.

## 통합 정합성 수정

- 자동 생성 graph의 폐기된 역사 세계 생성기·로더·출력 참조를 국가별
  `builtin-world` family로 교체했다. prepared-mesh와 build-metadata의 의존성도
  함께 바꾸고 실제 graph의 생성기·소비자 파일 존재와 연결을 검증했다.
- 폐기된 family의 생성 receipt만 제거했다. 다른 family의 과거 receipt는
  새 통합본에서 재검증한 것으로 표시하거나 지문을 임의 갱신하지 않았다.
- 기존 라이브러리 국기 미리보기의 72×48px 제한을 같은 값의 의미별 토큰으로
  옮겨, 새 UI 검사와 기존 라이브러리 구현 사이에서 드러난 2건을 해결했다.
  실제 크기나 동작은 바꾸지 않았다. CSS 번들은 소스에서 재생성했다.

## 검증 범위

원시 로그 및 작업 전 상태 기록은 저장소의 무시되는
`build-native/integration-20261021/`에 보존한다.

| 범위 | 결과 | 로그 |
| --- | --- | --- |
| 참조 이미지 Surface·취소·UI catalog·검사기 경계·Web 파일 목록·앱 staging 및 국가별 계획 | 관련 39개 검사 통과 | `focused-tests.log` |
| 실제 자동 생성 graph의 국가별 생성기/소비자/의존성 | 회귀 검사 통과 | `artifact-graph-test.log` |
| 제품 버전·manifest·import map | 통과 | `version-check.log` |
| UI 구조 및 CSS 소유권 | 발견한 2건 수정 후 통과 | `ui-architecture-final.log`, `ui-layering.log` |
| 실제 브라우저 공통 Surface | 제어 요소·부모·포커스·단일 이벤트 소유권 유지 통과 | `reference-surface-browser.log` |
| 병합된 JS 및 graph 회귀 테스트 ESLint | 통과 | `source-lint.log` |

국가별 로딩의 기존 역사 trace·Core 복원·월 전환·사용자 파일·새 프로젝트 검증은
[GEO-LOAD-20261021](../../geography/country-loading-current-month-2026-10-21.md)에
구체적으로 기록돼 있다. 이번 병합에서 해당 로직이나 GIS 좌표는 변경하지 않았다.
동일 검사를 이유 없이 반복하거나 전체 테스트·앱 실행 파일 빌드를 하지 않았다.

최종 main의 포함 관계와 Web 게시 파일 폐쇄 목록/커밋 바이트 일치는 병합 후
Git 객체 및 현재 파일을 비교해 확인한다. Web 파일 전체 복제나 배포 묶음은 만들지 않는다.
원격 push, CI/Pages 배포, 실제 Windows/Android WebView 기동은 이 보고서의
로컬 검증 결과와 별개다. 미실행 항목을 통과로 주장하지 않는다.

## 미커밋 작업 보존

UI 및 객체 워크트리의 수정·삭제·미추적 파일과 장소 워크트리의 미추적 파생
파일은 커밋되지 않은 별도 작업이다. 이번 통합에 임의로 포함하지 않았으며
stash/reset/clean/강제 checkout을 사용하지 않았다. main에 있던 미추적
`reports/annex-reproduction-20261015.png`도 보존했다. 상설 브랜치와 워크트리를
삭제하거나 다른 작업 브랜치를 변경하지 않았다.

> 2026-10-21 정리 후속: 이 문서에서 언급한 완료된 작업의 일부 원시 증거는 외부로 옮겼다. 작성 당시의 결과는 변경하지 않았다. [브랜치별 원래 경로·SHA-256·보관 목록](/D:/dev/release-evidence/PandoLab/branch-cleanup-20261021/main-archive.json).
