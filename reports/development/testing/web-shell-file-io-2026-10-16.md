# 웹·앱 공통 파일 입출력 — 2-2 구현 기록

> 보고서 ID: `DEV-079` · 상태: `investigating` · 지도 반영: `not-applicable` · 색인일: 2026-10-16
> 원문 최종 수정: 2026-10-16
> 조사 기준: `work/ui` / 2-2A `2b2542b`, 2-2B `82a46a8`, 2-2C `74dd808`
> 원본·출처: `assets/js/modules/gis-file-controller.js`, `apps/web-shell/`

## 목표와 변경 구조

웹의 정본 파일 메뉴 `#saveProjectBtn`, `#openProjectBtn`, `#openGisBtn`, `#dataExportBtn`를 유지한다.
웹에서는 기존 File Input/다운로드 및 가능한 경우 File System Access API를 사용한다.
Tauri 앱은 공통 `createGisFileController`의 선택적 `fileAccess`를 통해 시험판 Rust 다이얼로그에 연결한다.
`app-gis-assembly.js`는 프로젝트 파일·GIS 내보내기 모두 이 파일 소유자를 사용한다.

* 2-2A: 프로젝트 네이티브 저장/열기 → 기존 `projectDomain.save`와 `onFiles({sourceKind:'project'})` 사용.
* 2-2B: `.gpkg`, `.zip` GIS 내보내기를 네이티브 저장으로 연결. 쓰기 성공을 기다린 후 내보내기 창 닫기. 취소 시 창 유지.
* 2-2C: GIS 복수 파일을 네이티브 다이얼로그로 선택 후 원래 `onFiles({sourceKind:'vector'})`로 전달. 취소·실패 시 대상 및 포커스 복구.
* 2-2D: 이미 존재하는 프로젝트 저장 상태·취소 복구를 사용하고, UI 오류·재시도 회귀 테스트를 추가.

네이티브 명령은 `save_project_file`, `open_project_file`, `save_export_file`, `open_gis_files`다.
앱 임의 경로는 JavaScript에서 제공할 수 없다. 선택 경로는 OS 다이얼로그가 정한다.
Android 문서 공급자에서 이름을 알아낼 수 없는 파일은 확장자를 지어내지 않고 오류로 처리한다.

## 시험 및 한계

- 코드 변경에 대한 JavaScript 구문 확인: 실시, 통과.
- 집중 단위검사 18건(프로젝트 저장·가져오기 및 GIS 내보내기 14건, 네이티브 저장 연결 4건): GitHub 원본 소스를 가져온 격리 JavaScript 하네스에서 모의 `Blob`/`File`로 실행, 통과. Node 테스트 명령 자체를 실행한 근거가 아님.
- 추가 2-2D 취소·실패 테스트: 소스 추가. 공식 Node/Playwright 실행은 `NOT_RUN`.
- Rust 빌드, Windows 실제 Tauri 파일 선택창, Android 설치·터치·문서 제공자: `NOT_RUN`.
- 네이티브 시험판 파일 용량: 최대 1 MiB; GIS 다중 선택은 16개 및 합계 1 MiB 제한. 실제 대형 프로젝트 전송 최적화는 2-3 대상.
- Android `content://`의 표시 이름은 플러그인에 따라 원본 이름이 없을 수 있음. 확장자를 확인할 수 없는 제공자는 현 단계에서 거부하며, 실기기 2-4에서 판정.
- 웹과 앱의 저장 파일 내용·Undo·시간대·형상 전체 동등성은 실제 OS 테스트 전까지 미검증.

## 판정 및 다음 단계

`work/ui`에 코드와 집중 테스트가 반영됐다. 이는 실제 앱 빌드 통과를 의미하지 않는다.
2-2 기능 검증의 완료 조건은 현재 브랜치에서 `node --test tests/unit/project-save-picker.test.mjs tests/unit/gis-export-controller.test.mjs apps/web-shell/tests/native-storage.test.mjs`,
`pnpm --dir apps/web-shell test:native`, Windows Tauri 실동작, Android 실제 다이얼로그 검사이다.
기존 Qt 앱과 `main` 배포는 변경하지 않았다.
