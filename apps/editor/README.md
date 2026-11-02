# 판도연구소 Windows 검수기

> **운영 기준 (2026-11-02, E7/R2):** Windows Tauri 앱은 읽기 전용 검수기입니다. Android 네이티브 앱은 빌드·실행·아티팩트 설치 대상에서 제외되었으며, 모바일에서는 공개 반응형 웹 열람기를 사용합니다.

검수기는 `apps/viewer`의 동일한 지도·검수 UI를 `review.html`로 배포하되 Windows에서 평면(`flat`) 투영을 사용합니다. 지도·역사 시점·속성·국경 수정 전후를 조회하고, 근거 보고서 및 원본 SHA를 확인할 수 있습니다. 사용자가 명시적으로 지정한 **수정 요청서 JSON**과 진단 보고서 외에는 원본 GIS·프로젝트 파일 또는 GitHub에 쓰지 않습니다.

## 실행 및 빌드 (저장소 루트)

```powershell
pnpm.cmd deps:prepare
pnpm.cmd dev:web
pnpm.cmd --dir apps/editor dev:server
pnpm.cmd --dir apps/editor dev:windows
pnpm.cmd --dir apps/editor build:windows
pnpm.cmd --dir apps/editor build:verification:windows
pnpm.cmd --dir apps/editor test:native
```

`dev:server`는 로컬 포트 `127.0.0.1:4175`에서 Windows 검수용 Viewer 자산을 제공합니다. `dev:windows`는 GitHub Actions의 소스 고정 실행 파일을 받아 실행하며, 개발용 WebView는 해당 포트에 연결됩니다. Windows 네이티브 컴파일은 CI에서 수행하며, 미커밋 빌드 입력을 자동으로 커밋하지 않습니다. PowerShell에서 `pnpm.ps1`이 차단되는 경우 `pnpm.cmd`를 사용합니다.

`build:windows`는 `remote-development-p1.yml`에 Windows x64 오프라인 빌드를 요청합니다. CI의 `PandoLab-setup.exe` 및 `pandolab-web-shell.exe`는 커밋·입력 SHA-256·파일 해시를 검증한 후 불변 스토리지에서 재사용합니다. 생성된 설치 파일이 곧바로 공개 배포되지는 않습니다. 원격 아티팩트 보존 기간은 설정상 7일입니다.

네이티브 실행 모드는 `development`, `offline`, `verification`입니다. `test-fixture` 자료는 명시적인 `verification` 빌드에서만 사용 가능하고 일반 Windows 빌드는 `map-data`만 사용합니다. `--probe-auto` 등의 자동 검증 옵션은 시험 빌드에서만 허용됩니다.

## 권한과 파일 처리

- Windows 사용자 창은 `apps/editor/src-tauri/capabilities/prototype-review.json`의 `allow-write-diagnostic-report`, `allow-save-review-correction` 권한만 사용합니다.
- 검수 수정 요청서는 사용자 파일 저장 대화상자에서 직접 지정한 경로에만 저장됩니다. 기존 프로젝트·GeoPackage 작성, Undo/Redo, GIS 데이터 변경, Git 승인·병합은 허용되지 않습니다.
- 실제 Windows 창은 `review.html`만 열고 외부 내비게이션과 새 창을 차단합니다. 고정된 출처의 검수 자료만 읽습니다.
- 기존 Windows 앱 식별자 `com.pandolab.webshell.prototype`는 사용자 설치 및 데이터 경로 호환성을 위해 R2에서 변경하지 않았습니다. 제품명·패키지 식별자 변경은 별도 마이그레이션 작업으로 다룹니다.
- 이전 Windows 사용자 데이터·원본 GeoPackage와 과거 Android 캐시는 이번 정리에서 삭제하거나 이동하지 않습니다.

## 수용 검사

`e6-retirement-acceptance.yml`, `e7-final-readonly-regression.yml` 및 R2 네이티브 계약 테스트에서 Viewer 소스 격리, 수정 명령 거부, Windows 빌드·WebView2 실제 실행, 아티팩트 무결성, Android 빌드·APK 차단을 검증합니다. Windows 설치 파일을 별도로 배포했다는 뜻은 아닙니다.

역사적 편집기·Android 프로토타입 구현 과정은 Git 기록과 [E0 기준](../../docs/development/editor-retirement-e0.md), [E5 Windows 검수기 전환](../../docs/architecture/windows-review-e5.md), [E7 검증](../../docs/architecture/web-windows-final-regression-e7.md)에 남겨둡니다.
