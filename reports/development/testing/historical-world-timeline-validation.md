# 기본 세계 역사 타임라인 검증

> 보고서 ID: `DEV-003` · 상태: `historical-record` · 지도 반영: `not-applicable` · 색인일: 2026-10-12  
> 원문 최종 수정: 2026-10-12  
> 원본: [웹 `docs/historical-world-timeline-validation.md`](https://github.com/kimjeon-il/Pando/blob/e2efceb6788f5b9e1f682916b8b9763f7bc2db85/docs/historical-world-timeline-validation.md)  
> 동일한 앱 원본: [앱 `docs/historical-world-timeline-validation.md`](https://github.com/kimjeon-il/PandoEditor/blob/f535673993f45957b82d125ff766ed1e18233170/docs/historical-world-timeline-validation.md)  


## 적용 범위와 결과

Web와 App의 새 기본 프로젝트가 기존 역사 자료 전체를 같은 날짜 기록으로 연결한다. 자료 없는 날짜의 국가는 숨기며, 기존 저장 프로젝트를 자동 변경하지 않는다. 화면 날짜는 월말 기준으로 해석한다.

- `2012-10`: 크림 확인점 `[34.1, 44.95]`의 소속은 `state:ukraine`이다. 현대 러시아의 미리보기·라벨·선택 영역이 남지 않는다.
- `2014-02`: 우크라이나 역사 형상이 표시된다.
- `2014-03`, `2015-10`: 기존 우크라이나 자료가 `2014-03-17`에 끝나므로 월말에는 숨긴다. 자료가 없는 러시아 형상을 대신 표시하지 않는다.
- 현대 자료는 원본 기준 월 `2026-10`에만 사용한다. 다른 월로 형상 기간을 임의 연장하지 않는다.

## 동일 산출물

Web `assets/data/historical-world/generated/v1/`와 App `assets/world/historical-world/v1/`의 manifest, project, coverage report, expected trace는 동일하다.

| 항목 | 값 |
| --- | --- |
| 정체성 | 280개: 현대 254개, 역사 26개 |
| 압축 / 해제 바이트 | 6,202,166 / 17,717,557 |
| 저장 바이트 SHA-256 | `1c2fcd0e66ae2726b53946cdbd18d7d7d686ab66eecf285e70cfd3e9df843155` |
| 공통 비교 월 | 1900-01, 1941-04, 1945-11, 1991-08, 1991-12, 2012-10, 2014-02, 2014-03, 2015-10, 2020-10, 2020-11, 2026-10 |

## 실행한 집중 검증

사용자 요청에 따라 이미 통과한 검사를 반복하거나 무관한 전체 검사를 추가하지 않았다.
마지막 색·국기 수정 전의 성공 결과를 재사용했다. 해당 수정은 기간·형상·부모 기록을 바꾸지 않으며, 갱신된 산출물은 기본 표시값 검사, 해시·결정성 확인 및 아래 최종 native 편집·저장/공통 trace 검사로 확인했다.

### Web

- `pnpm.cmd check:historical-world`: 현재 입력으로 재계산한 산출물과 위 해시 일치.
- compiler / 영토 조정 / publication 집중 검사: 15/15 통과. 원본 기간, 부모 공백, 중첩 처리와 결정성을 검증했다.
- 마지막 검토에서 발견한 역사 국가의 기본 색·루트 국기 누락: 직접 재현 검사 실패를 확인한 뒤 수정하여 1/1 통과. 하위 영토의 국기 상속은 유지했다. 해당 JS 파일 ESLint와 갱신한 publication `--check`도 종료 코드 0.
- loader / reset / startup / renderer / 날짜·저장 연결 9개 unit 파일: 46/46 통과.
- `tests/browser/historical-world-timeline.spec.mjs`: Canvas와 WebGL2에서 12개월 실제 UI 이동, 크림 클릭, 현대 라벨 제거, 기본 지도 초기화, 역사 형상·소속 편집, 잠금, Undo/Redo 검증 4/4 통과.
- 날짜 입력·이동 2개와 기존 정적/복합 타임라인 저장 2개: 4/4 통과.
- 전체 기본 세계 파일 저장·열기, full autosave, 역사 asset 요청 차단 후 offline 복원: 별도 단일 실행 1/1 통과 (`timeline-persistence.spec.mjs`, 2.7분).
- 통합 browser 실행은 위 8개 성공 후 메모리 부족으로 마지막 persistence worker를 직접 중단했다. 마지막 사례의 별도 성공 결과를 사용하며 통합 9/9 성공으로 기록하지 않는다.

화면: [Web 2012년 크림반도](https://github.com/kimjeon-il/Pando/blob/work/objects/docs/validation/historical-world-timeline/web-crimea-2012.png).

### App

- 전용 빌드: `D:/build/Pandoeditor-objects`, Qt 6.8.3 / MinGW 13.1, source `D:/dev/worktrees/app/objects`.
- 역사 loader와 기존 builtin policy 대상 CTest: 2/2 통과. 자료 누락·손상 거부와 현재 기준 형상/ID 일치를 검증했다.
- `node tools/sync-historical-world-timeline.mjs --web-root D:/dev/worktrees/web/objects --check`와 기존 세계 자산 검증: 통과.
- `autosave_tests canonicalIdsDoNotReplaceEditedCoordinates`: 선택 사례 1/1 통과. 현대 기본 ID를 유지한 좌표 변조도 mesh 재사용을 거부한다.
- `node tools/historical-world-timeline-parity.mjs D:/build/Pandoeditor-objects/historical_world_resolution_probe.exe D:/dev/worktrees/app/objects/assets/world`: 12개월 모두 일치. 실제 native 저장·읽기 후 활성 ID, 원본 버전, 부모, root, 형상 참조와 크림 확인점의 소속을 공통 JS trace와 대조했다.
- `historical_world_ui_tests`의 날짜 변경, 늦은 mesh, reset, offline full autosave 복원, 활성 형상에만 mesh 적용, 준비 실패 5개 선택 함수: 5/5 통과(초기화/정리 포함 QtTest 7/7, 173.439초, 종료 코드 0). 실제 controller의 표시·선택을 검사했다.
- 마지막 검토에서 발견한 비활성 canonical 형상의 좌표 변조: 다른 월에서만 활성인 DEU를 편집하면 mesh 검사를 통과하던 실패를 확인했다. 전체 캐시 프레임에 들어가는 모든 기존 canonical 참조를 대조하도록 수정했다. 현재 월의 활성 참조가 하나 이상 일치해야 한다는 조건도 유지했다.
- 마지막 선택 함수 `inactiveCanonicalCoordinatesAreCheckedBeforeMeshReuse`, `historicalEditsAndFullSaveRetainAllMonths`: 2/2 통과(초기화/정리 포함 QtTest 4/4, 60.380초, 종료 코드 0). 비활성/활성 월의 좌표 변조 거부, 실제 역사 국가 국기·색, 잠금, 월별 형상 변경, 유효 부모 생성·소속 변경, Undo/Redo 및 전체 파일 저장·읽기 후 13개월 기록 보존을 확인했다.
- 갱신한 위 SHA의 자산으로 native parity 재확인: 12개월 모두 일치, 종료 코드 0. 최초 PowerShell 실행의 종료 코드 0만으로는 빈 결과 로그에서 선택 함수 통과를 확인할 수 없었으므로, Node `spawnSync`와 명시적 Qt 결과 파일로 위 두 함수만 확인했다. 이미 증거가 있는 검사는 반복하지 않았다.

## 실행하지 않은 범위

무관한 전체 unit/browser/CTest, 추가 native 창 점검, Android 기기, 전체 앱 배포 패키지와 실제 배포본 검증은 수행하지 않았다. App의 날짜 커서는 기존 계약대로 세션 상태이며 저장 형식을 바꾸지 않았다. 재열기 때는 기존 초기 월 선택 규칙을 따른다. 320px Web 날짜 입력 검사는 유지했으며 별도 이동 검사는 데스크톱 폭에서 실행했다. 기존 좁은 화면의 떠 있는 이미지 도구가 화살표를 가리는 문제는 이 변경에 포함하지 않는다. App의 기존 소속 변경은 부모 밖 형상을 거부하므로, 소속 변경 검사는 실제 생성 명령으로 만든 포함 가능한 부모를 사용한다.

이 문서는 `work/objects` 구현에 대한 증거이며 `main` 반영이나 배포 완료를 뜻하지 않는다.

## 판단 기록

구현 중 내린 판단과 잘못 판단했을 때의 영향을 아래에 보관한다. 이후 사용자 요청이 우선한다. 특히 이미 통과한 검사의 반복 및 추가 창 점검은 사용자의 검사 범위 축소 요청으로 제외했다. 마지막 검토는 독립 리뷰 1회로 끝냈으며, 중요 문제 2건만 직접 실패 재현 후 수정했다. 경미한 보류 항목은 없다.

- Ruling: Focused checks take precedence over skill full-suite instructions — AGENTS and accepted user preference explicitly limit unrelated checks — cost if wrong: an unrelated regression may remain undetected.
- Ruling: Retain the plan workspace after completion — mandatory permanent-worktree policy forbids automatic cleanup — cost if wrong: small scratch files remain on disk.
- Task 2: Ruling: generic parent clipping would delete modern overseas territories — retain authoritative joint modern geometry and clip historical descendants only when an ancestor changes — cost if wrong: unsupported historical parent topology needs explicit additional policy.
- Task 6: Ruling: preserve the narrow-screen date editor checks, then return to desktop for the separate blur/navigation check — a pre-existing floating image toolbar intercepts the 320px arrow click — cost if wrong: the unrelated narrow arrow overlap remains outside this task.
- Task 6: Ruling: run heavy browser persistence and native linking sequentially after memory headroom fell below 1GB — stopped only the verified current Playwright process tree and retain its 8 passing case outputs — cost if wrong: interrupted aggregate run must be repeated before completion.
- Final: Ruling: apply historical display defaults in the compiler — existing library materialization supplies defaultColor and root flagDataUrl, and the focused regression reproduces their absence — cost if wrong: generated default appearance changes; child flag inheritance remains unchanged.
- Task 4: Ruling: plan configuration omits ZLIB search paths required by this machine — use installed MinGW include/libz.a in the dedicated build — cost if wrong: host-specific validation configuration only.
- Task 4: Ruling: Debug compilation exceeds MinGW object section limit — pass -Wa,-mbig-obj in the dedicated build, leaving product source unchanged — cost if wrong: validation requires this compiler flag.
- Task 4: Ruling: synchronized main cannot compile editorplace.cpp because the date variable declaration omits auto — repair that one declaration to enable native validation — cost if wrong: one prerequisite change in place-label code.
- Task 4: Ruling: compare immutable modern MultiPolygon components as an exact multiset — the shared snapshot and pinned native packet append the same two Colombia islands in opposite order — cost if wrong: a component-order-only source change is accepted; altered vertices and duplicate/missing components still fail.
- Task 4: Ruling: strip debug information from this dedicated build object files once — MinGW archive/link processing of 650MB debug artifacts dominates focused validation — cost if wrong: retained build lacks source-level debug information; rebuilding restores it. Executable code and source are unchanged.
- Task 5: Ruling: use -O0 -g1 for the dedicated Debug build after object stripping invalidated Ninja dependency timestamps — source-level line information remains, with much smaller archive/link input — cost if wrong: debugger detail is reduced and one full dedicated rebuild is needed.
- Task 5: Ruling: retain session-only cursor persistence and existing initialTimelineMonth on restore — the approved spec preserves the native save format, which stores no selected month — cost if wrong: reopening selects the existing initial month rather than the last viewed month. Scene mesh ownership already checks inactive IDs and exact active bindings; fix the bootstrap/view callers rather than duplicate this engine policy.
- Task 5: Ruling: the first recovery test fixture wrote raw project JSON where ProjectAutosave requires its existing envelope — corrected the fixture with scheduleDocument/flushNow after the two controller cursor failures were reproduced; recovery changes also follow the inspected dated-view violation — cost if wrong: the corrected recovery path lacks an isolated pre-fix failing run. No production envelope format changes.
- Task 6: Ruling: prepare the independent resolver probe and command roundtrip test while Task 5 links — these consume the completed Task 4 canonical document, and new build targets wait for Task 5 verification — cost if wrong: repeat the probe against the final Task 5 build.
- Task 5: Ruling: serialize native executable linking with a dedicated CMake/Ninja history_link=1 job pool while compiling in parallel — three large simultaneous linkers would consume the remaining memory — cost if wrong: test binaries finish sequentially; product configuration is unchanged.
- Task 5: Ruling: omit debug sections when linking dedicated validation executables after a 10-minute GNU linker run — retain -g1 object archives, use --strip-debug only at executable link, and preserve source/Qt DLLs — cost if wrong: these test executables cannot provide normal source-level debugger details; QTest assertions still report file/line.
- Task 6: Ruling: native timeline.parent already rejects Ukraine under non-containing Nagorno-Karabakh with GEOMETRY_OUTSIDE_PARENT — retain this existing guard and test a valid containing parent created with the actual timeline.create command instead — cost if wrong: Web/App retain their existing difference for out-of-parent relationships; no production guard was weakened.
- Final: Ruling: materialize historical default colors and root flags in the compiler — existing library materialization does this, and the focused regression failed before the change — cost if wrong: generated appearance defaults differ; child flag inheritance stays unchanged.
- Final: Ruling: verify every present canonical geometry before returning the all-country mesh — an inactive-DEU tamper regression failed before the change, and the cached frame is reused after cursor changes — cost if wrong: one altered unused alias also disables the optional mesh; document geometry still renders.
- Final: Ruling: hide Ukraine/Russia in unsupported 2015 months — explicitly approved missing-data policy, rather than guessed lifetime extension — cost if wrong: a sparse map until historical source coverage is added.
- Final: Ruling: keep native cursor session-only — approved save-format preservation and existing initialTimelineMonth contract — cost if wrong: reopening may select a different month from the last viewed month.
- Final: Ruling: retain existing platform parent-containment rules — App already rejects out-of-parent geometry, and Web behavior is independently owned — cost if wrong: the same invalid relationship remains accepted/rejected differently across platforms.
- Final: Ruling: preserve authoritative modern overseas geometry — generic clipping would remove existing overseas components — cost if wrong: unsupported topology requires explicit future handling.
- Final: Ruling: leave the 320px image-toolbar overlap outside this change — date input is verified at narrow width and separate navigation at desktop width — cost if wrong: the existing narrow arrow overlap remains.
- Final: Ruling: connect the current historical library without new source research/generalization — this is the approved implementation scope — cost if wrong: future source forms or uncovered dates need separate work.
- Final: Ruling: omit whole packages, Android, extra native windows and deployed-release validation — user explicitly narrowed verification and main/deployment are not authorized — cost if wrong: packaging/device/live-specific issues remain unverified.
- Final: Ruling: do not infer pending native success — record controller 5/5 already observed, then run only the two remaining direct functions and final-asset parity — cost if wrong: completion must wait for those actual outcomes.
- Final: Ruling: require explicit Qt case results after the first invocation produced an empty log — process status alone cannot prove both selected functions ran successfully — cost if wrong: one additional 60-second run of these two previously unconfirmed cases; passed controller/Web cases were not repeated.
