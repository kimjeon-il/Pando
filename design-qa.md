# Info tab v9 — implementation and visual verification

검증일: 2026-10-06. 작업 브랜치: `codex/info-tab-v9`.
기준 main: `933eb5efc21533574ff6d826361d0395a2a710c0`.
검증한 구현 커밋: `a1555722813fbb7f2ae397f1999e21dd9fa0ed66`.
후속 커밋은 아래 빌드 메타데이터와 이 문서만 갱신한다.

## Source and captures

- 지침: `C:/Users/taeeu/Downloads/codex_info_tab_v9_instructions.md`.
- 시각 기준: `C:/Users/taeeu/Downloads/pandolab_info_tab_mockup_v9.html`.
- 기준 캡처: `test-results/info-v9-reference-desktop.png`, `test-results/info-v9-reference-mobile.png`.
- 최종 캡처 디렉터리: `test-results/info-v9-console-acceptance/info-tab-v9-info-v9-derive-d160f-data-validation-and-history/`.
- 최종 파일: `info-desktop.png`, `info-mobile-top.png`, `info-mobile.png`, `info-mobile-bottom.png`.
- Desktop viewport 1440×900, 기준 패널 380×569px / 실제 패널 320×820px.
- Mobile viewport 390×844, 기준 패널 390×569px / 실제 sheet 390×405px.
- 모두 deviceScaleFactor 1, CSS px와 이미지 px 동일. 프레임 전체 비례 확대/축소 없이 패널 캡처를 함께 열어 비교했다.
- 상태: 부모 한 개·자식 두 개, 두 번째 이름은 길게 표시. 실제 저장소에서 읽은 이름과 현재 국기 asset을 사용했다.
  mockup의 데모 이름·emoji·지도·pin·헤더 부연 문구는 가져오지 않았다.

## Comparison and findings

초기 Canvas 회귀에서 모바일 GPS 최소 너비가 고정 grid 열을 넘는 P2 문제를 발견했다.
`info-v9-canvas/.../test-failed-1.png` 및 로그에 실패 증거가 있다.
마지막 열을 `auto`로 바꿔 기존 모바일 터치 크기를 보존했고, 재캡처에서 긴 이름은 말줄임되며 버튼과 행이 넘치지 않는다.
최종 데스크톱·모바일 캡처를 기준 캡처와 같은 비교 입력에서 다시 확인했다.

- Fonts/typography: 기존 label/body/input 토큰을 유지했다. 이름 및 관계 이름이 읽히며 긴 이름만 말줄임된다.
- Spacing/layout: 이름 → 소속 → 산하 → 존속기간 → 비고 순서, borderless 관계 행과 오른쪽 이동 버튼을 확인했다.
  패널 너비·헤더·sheet 높이는 기존 제품 레이아웃을 유지한다. 모바일에서는 기존 scroll body로 모든 필드에 접근한다.
- Colors/tokens: 기존 neutral label/text/white surface/control border와 hover 토큰을 사용한다. 관계 행에 카드 배경·테두리·구분선이 없다.
- Assets: 실제 국기 이미지의 로딩을 확인했다. 현재 헤더와 같은 semantic `focus` 아이콘(`#icon-focus-target`)을 사용했다.
- Copy/content: 소속·산하는 관계가 있을 때만 나온다. 빈 관계 문구·객체 종류 부연·기간 placeholder를 표시하지 않는다. 메모 → 비고.
- 의도된 차이: 정적 프로젝트에는 날짜가 모두 null이므로 기간 입력은 빈 칸이다. 유한 날짜 저장 거부는 아래 사용자 결정에 따른다.
- 집중 비교: 패널 캡처에서 관계 행·이동 버튼·입력·말줄임이 읽힐 만큼 크게 보이며 별도의 확대 crop은 필요하지 않았다.

final result: passed

## Canonical behavior

관계는 기존 `territorialEntityRepository.parent/children`에서 매번 파생하며 별도 관계 상태를 만들지 않는다.
관련 이름·국기는 기존 `getTerritorialView`의 displayName/flagUrl을 사용한다.
버튼만 기존 `focusObjectRef`를 호출한다. 현재 선택을 유지하고, 기존 헤더 이동 명령과 중심·scale 결과가 일치한다.
한 칸 문자열은 기존 `normalizeTemporalInterval`로 `{validFrom, validTo}`에 변환해 기존 metadata command에 한 번 전달한다.
날짜 정밀도·BCE·확장 연도·윤년·연도 0 거부·양끝 포함 의미 및 저장 스키마는 변경하지 않았다.
비고와 관계 변경, Undo/Redo는 기존 경로를 사용한다.

## Executed checks

모든 아래 성공 명령 exit 0. 로그와 captures는 ignored `test-results/`에 보존했다.

| Command | Result | Evidence |
|---|---|---|
| `node --test tests/unit/territorial-info-period.test.mjs tests/unit/territorial-property-controller.test.mjs tests/unit/territorial-service.test.mjs tests/unit/territorial-metadata-command.test.mjs tests/unit/label-metadata-edit.test.mjs tests/unit/hydro-metadata-edit.test.mjs` | 51 pass / 0 fail / 0 skip | `info-v9-focused-final.log` |
| `pnpm.cmd build:ui-bundle` | source CSS에서 번들 생성 성공 | `info-v9-bundle-final.log` |
| `pnpm.cmd check:ui` | 6 audits + 18 tests pass / 0 fail / 0 skip | `info-v9-ui-final.log` |
| Changed product JS and affected unit/browser files: `pnpm.cmd exec eslint ...` | 0 errors | `info-v9-eslint-final.log`; 최종 브라우저 검사 추가 뒤에도 해당 파일 lint exit 0 |
| `node scripts/check-runtime-boundaries.mjs` | 302 modules / no cycles | direct tool output |
| `git diff --check` | pass | direct tool output |
| Existing PyYAML BaseLoader workflow assertions | 4 pass | `info-v9-workflow.log` |
| `PANDOLAB_TEST_PORT=4202 pnpm.cmd exec playwright test tests/browser/info-tab-v9.spec.mjs --output=test-results/info-v9-console-acceptance` | Canvas 1 pass / 0 fail / 0 skip; console/page errors 0 | `info-v9-console-acceptance.log` |
| `pnpm.cmd generate:build-meta` | `0.35.0-build-a1555722813f` 생성 성공 | `info-v9-build-meta.log` |
| `pnpm.cmd check:version` | pass | `info-v9-version.log` |

브라우저에서는 production GeoPackage Worker로 파일을 만들고 실제 불러오기 UI를 사용했다.
네 가지 관계 존재 조합, GPS와 이름 클릭의 차이, 관계 변경·Undo, 유한/잘못된 기간의 거부와 데이터 보존,
빈 기간 no-op 후 Redo 보존, 비고 변경·Undo/Redo, desktop/mobile overflow 및 scroll 접근을 검증했다.
없는 기능/옛 DOM을 검출한 RED와, 정상 빈 기간 표시 RED, 모바일 overflow RED를 각각 최소 수정 후 같은 집중 검사로 확인했다.

## Incomplete or failed verification

- WebGL 초기 실행은 Undo 단계에서 210초 timeout, 1 fail (`info-v9-browser-verified.log`).
- WebGL raster 재실행도 비고 변경 뒤 browser 응답 지연으로 완료하지 못해 중단했다 (`info-v9-raster.log`, partial trace).
  정확한 원인은 확정하지 않았다. Canvas 통과를 WebGL 통과나 렌더러 전체 연속성 확보로 간주하지 않는다.
- 전체 suite, 기존 긴 `runtime.spec.mjs`/`unified-objects.spec.mjs`의 전체 실행은 하지 않았다.
  해당 파일의 기간 selector와 기존 정적 계약에 맞는 assertions는 갱신했다.
- CI workflow에 집중 단위 검사 및 Canvas 브라우저/evidence 업로드를 연결했지만 원격 CI 실행은 하지 않았다.
- main 병합·배포·앱 패키징은 이번 작업에 포함하지 않았다.

## Separate finite-period saving review

사용자는 두 차례 **유한 기간 저장도 별도 작업으로 검토**를 선택했다.
이번 작업에서는 기존 `TIMELINE_ACTIVATION` 정적 UI 정책을 유지하고 유효한 유한 기간도 저장하지 않는다.
교환 코덱이 복잡한 timeline project를 저장할 수 있다는 사실은 활성 UI 편집을 허용한다는 뜻이 아니다.
후속 검토는 feature 파생값이 아닌 lifetime record의 정본 변경 경로, 실패 원자성/history,
유한 프로젝트의 재열기·활성화 판정 및 앱 PandoEditor와의 계약 대조를 먼저 확정해야 한다.
승인 없이 공통 계약·스키마·activation guard를 바꾸지 않는다. 별도 기능은 아직 구현하지 않았다.
