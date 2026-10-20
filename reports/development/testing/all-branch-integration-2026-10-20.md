# 작업 브랜치의 미통합 변경 전체 반영

> 보고서 ID: `DEV-ALL-BRANCH-20261020` · 상태: `integrated-with-validation-exception` · 지도 반영: `not-applicable` · 색인일: 2026-10-20
>
> 원문 최종 수정: 2026-10-20 · 통합 전 main `b0d030d1c870a1eaef72b666a3ca2c6d00534333` · 제품 통합 SHA `93cf8946dc815f05321b1471141e3717abfe6a36`

## 범위와 포함 내용

사용자가 각 브랜치에서 main에 없는 내용을 모두 main과 다른 브랜치에 반영하도록 요청했다. 원격을 fetch한 뒤 main 기준의 고유 이력과 파일 차이를 확인했다. 미커밋 작업은 통합 커밋에 포함하지 않는다.

| 브랜치 | main에 추가할 내용 |
| --- | --- |
| work/ui | `fe593049af88`의 공통 보기 메뉴·모바일 패널 정리, `85e79eb71a8b`의 생성물, 병합 이력 `812320d35bd4`, `5256480a`의 웹 열람 메뉴 브라우저 검사. 진행 중 추가된 `fdc7cd43`의 검사 진단과 `321e89a6`의 진단 정리·웹 루트 수정도 병합했다. |
| work/gis | `310ee5e674c4`의 10월 20일 보고서 검토·국가 존속기간 조사 진행·색인 6개 파일과 기존 병합 이력. 역사 형상 데이터 변경은 없다. |
| work/objects·work/places | 고유 커밋은 없었다. 기존 미커밋 실험·자료는 보존하면서 통합 main을 가져온다. |
| feature/reference-image-p1-layout-20261018 | 원격에만 남은 이전 브랜치이며 기존 커밋 `af9327b3`는 이미 main에 포함돼 있었다. 기존 이력을 보존하는 fast-forward로 최종 기준을 반영한다. 새 로컬 브랜치·워크트리는 만들지 않는다. |

## 검증

관련 제품 HTML·MapSettings·평면 편집 정책 단위 9개는 통합 전과 통합 main에서 모두 통과했다. 변경된 작성 JS/MJS lint와 생성물 `--check`도 통과했다. 앱 시작점의 Canvas 보기 메뉴·키보드·모바일 전환·문서 불변 브라우저 검사가 통과했다.

새 웹 검사에서 앱 전용 `#app`을 찾던 참조를 현재 웹 템플릿의 `#viewer`로 수정했다. 수정 후 웹 데스크톱·모바일 검사는 두 실행에서 통과했지만, 마지막 진단 정리 커밋을 반영한 재검사와 동일 조건 재시도에서는 첫 `#mapDisplayBtn.click()`이 각각 10초 시간 초과했다. 로그상 버튼은 visible/enabled/stable이며 스크롤 완료까지 확인된다. 이 정보만으로 GPU·렌더러·메뉴 중 어느 것이 원인인지 확정할 수 없다. 이전 통과를 최종 통과로 표시하지 않으며, 시간 제한 확대·검사 삭제·제품 코드의 추측성 수정은 하지 않았다. 마지막 웹 검사는 실패 상태다. 두 실패 로그는 `browser-viewer-latest.log`, `browser-viewer-trace.log`에 남겼다. 추적 옵션으로 재시도했으나 trace.zip은 생성되지 않았다.

통합된 GIS 보고서의 원래 연구 증거·한계를 유지한다. 문서 병합은 지리 자료 적용이나 역사 형상 정밀도 검증이 아니다.

검증·통합·원격 ref의 최종 결과와 미검증 항목은 아래 완료 기록 및 실행 원본에 구분한다. 원시 로그·파일 해시와 복구용 원본·patch는 `.superpowers/sdd/2026-10-20-all-branch-integration/`에 보관한다.

## 보존

통합 전에 main·UI·objects·GIS·places의 tracked 변경을 복사하고 모든 미커밋/미추적 작업 파일의 byte hash를 기록했다. objects 색인에 겹치는 미커밋 1행은 별도 원본·patch로 보존한 뒤 새 정본 색인과 함께 유지한다. `.gitattributes`, Tauri 권한, 줄바꿈 상태, 미추적 실험·증거, 지명 anchor 작업은 커밋하지 않는다. stash·reset·clean·강제 push·워크트리 정리를 하지 않는다.

통합 후 원본 해시 비교에서 main 1개·UI 1327개·places 3개 작업 파일이 동일했고 누락은 0개다. objects는 10개 파일이 동일하며 색인만 새 공통 행을 포함해 달라졌다. 원래 미커밋 `PERF-PREDICATE-20261018` 행과 HEAD 대비 1행 추가 diff가 유지된다. GIS는 원래 미커밋 작업이 없었다.

UI의 0바이트 index.lock은 Git 프로세스가 없는 상태에서도 지속됨을 확인한 뒤 원시 증거 폴더로 이동해 보존했다. 동시 원격 추가 때문에 atomic push가 두 번 거절됐을 때 부분 push는 없었으며, 새 커밋을 모두 fetch·병합해 다시 반영했다. 진단 블록의 단일 충돌은 양쪽 변경을 확인하고 최종 진단 삭제 및 실제 동작 검사를 유지해 해결했다.

## 완료 기록과 한계

제품 통합 SHA `93cf8946dc815f05321b1471141e3717abfe6a36`에서 main·work/ui·work/objects·work/gis·work/places의 로컬 HEAD와 원격 6개 전체 브랜치가 동일함을 확인했다. 원격 전용 feature 브랜치도 같은 SHA로 fast-forward했다. 최종 보고서·증거만 추가하는 후속 커밋도 같은 방향으로 전파한다. 미커밋 작업은 사용자의 작업 상태로 남긴다.

[Pages 실행 39361225346](https://github.com/kimjeon-il/Pando/actions/runs/39361225346)은 제품 통합 SHA와 일치하며 성공했다. 실제 게시 사이트에서 Microsoft Edge headless 1280×800, 명시적 `renderer=canvas`로 보기 메뉴·평면 전환·시점 이동을 실행했다. `canvas-worker`, build `0.36.0-build-fe593049af88`, document unchanged, dirty=false, pageerror 0개를 확인했다. 이 결과는 로컬 기본 렌더러 검사 실패를 해소했다는 증거가 아니다. 실행 증거는 [동봉 JSON](all-branch-integration-2026-10-20.evidence.json)과 원시 `live-browser.json`에 기록한다.

Windows 실행 파일 재빌드 및 Android 실제 기기 검증은 이번 통합에서 수행하지 않았다. 앱 시작점 브라우저 검사를 네이티브 실행 증거로 대체하지 않는다. 브랜치 통합·보존은 완료됐으며, 기본 렌더러 웹 보기 버튼 시간 초과의 원인은 미해결이다.
