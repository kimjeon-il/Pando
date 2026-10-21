# 웹 열람·앱 편집 분리 배포 검증

> 보고서 ID: `UI-PRODUCT-RELEASE-20261018` · 상태: `pages-live-verified / native-device-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-18
> 소스: `2574f1e0` (`feat: separate web viewing from native editing`)
> 배포 승인: 사용자의 “배포까지 ㄱㄱ” 지시

## 배포 범위

웹은 기존 UI를 유지한 열람 화면, Windows·Android 앱은 별도 편집 시작점을 사용한다. 웹 화면에 뷰어 표기를 추가하지 않았다. 휴대폰 패널과 Android 방향 정책 소스도 같은 커밋에 포함된다. 이번 공개 배포 대상은 GitHub Pages 웹이며 APK·Windows 설치 파일 발행은 수행하지 않는다.

상설 `work/ui`의 미완성 프로젝트 설정·프로젝트 날짜 비교·모바일 정점 도구 변경은 별도 작업 기록의 배포 제외 지시에 따라 커밋에서 분리했다. 원본 작업 파일은 변경하지 않고 Git index에 이번 작업만 반영했다. 미완성 변경을 stash/reset하거나 삭제하지 않았다. `main`의 기존 미추적 `reports/annex-reproduction-20261015.png`도 보존했다.

앞선 [작업 사본 검증](web-app-product-split-2026-10-18.md)은 미완성 변경이 함께 있는 개발 상태의 기록이다. 실제 릴리스는 배포 대상만 추출한 소스로 WASM을 다시 빌드하고 아래 검사를 새로 실행했다. 해당 이전 보고서의 Core SHA·파일 수·기존 정적 검사 실패를 이번 릴리스 결과로 사용하지 않는다.

## 릴리스 식별

- 버전: `0.36.0-build-20261018-product-split`
- 데이터 revision: `data-1d70896e8c76322bd4df52bff683d4d8`
- Core source SHA: `7aa0b76e1d69612455145b65d258e02046a505bcfb69dfd51086d6450b06430a`
- WASM SHA: `c823967e8a89e2b65261c731e0d3ee78f5d13cee52b055671b67c93d0ff8dfdf`
- 기존 `904a5cf6` 기준에서 배포 제외 변경을 제거하고 분포 날짜 문자열 직렬화 수정만 공통 C++에 포함했다.

## 실행한 검사

| 대상 | 결과 |
| --- | --- |
| 분리된 소스의 Node 검사 | 40/40: 읽기 전용 Core, 파일 실패/교체, 지도 표시/지명, Worker 의존성, 화면 판정, Android 설정 동기화, 앱 staging |
| metadata·Pages 계약 | 7/7, 버전 검사 및 대상 ESLint 통과 |
| UI 정적 검사 | UI components 및 architecture 통과 |
| 대표 브라우저 흐름 | 7/7: 웹 PC/640×360, 실제 GeoPackage 열기/손상/연속 요청, Canvas 클릭, 앱 844×390/640×360 초안·키보드·Undo/Redo, 지명 생성/속성 수정, 저장·재열기·자동저장 복원 |
| main 통합 후 검사 | Core 정책·자산 의존성·원자적 문서 교체 12/12, metadata 검사 통과 |
| 앱 실제 staging | small-project 913개 / 56,152,746바이트; full-world 1,520개 / 151,527,808바이트. 같은 릴리스 Core SHA 확인 |

검증용 소스 디렉터리는 `D:/build/pandolab-product-release-source`, WASM 빌드는 `D:/build/pandolab-product-release-wasm`이다. 새 브랜치·Git 워크트리를 만들지 않았다. 앱 staging 최종 디렉터리는 full-world 결과이며 small-project 검사 결과는 별도 JSON에 기록했다.

main의 오래된 로컬 의존성에는 esbuild 연결이 없어 첫 통합 검사가 실패했다. 캐시를 삭제하지 않고 이미 설치된 선언 버전 `esbuild@0.25.10`을 연결한 뒤 동일 검사를 다시 실행하여 통과했다. Pages CI는 lockfile 기준으로 의존성을 설치한다.

## 공개 배포

- `main` 및 `work/ui`에 `2574f1e0e9b47b054e8c38d2c392aad8e79698c7` 푸시 성공. main은 fast-forward로 통합했다.
- [Pages workflow 39123723696](https://github.com/kimjeon-il/Pando/actions/runs/39123723696) build/deploy 성공. 실제 배포 SHA는 위 소스와 일치한다.
- [공개 사이트](https://kimjeon-il.github.io/Pando/)에서 내장 지도 시작, 현재 `.gpkg` 열기, 검색·객체 정보, 640×360 전환 및 투영 변경, Ctrl+Z 이후 문서 변경 없음 확인. 브라우저 page/console 오류 0건.
- index, build metadata, 시작 JS, 지도 JS, 공통 CSS, WASM manifest, WASM의 HTTP 200 및 Git 커밋 바이트 SHA-256 일치 확인.
- 편집 `app.js`, `bootstrap.js`, `ui.bundle.css`, `apps/web-shell/editor.html` 공개 URL은 모두 HTTP 404.
- 웹 산출물 **2,147개 / 431,074,572바이트**. 로컬 staging과 CI에서 내려받은 Pages evidence의 전체 2,147개 경로·SHA-256이 일치한다. 앱 소스 103개, 공통 소스 173개 제외.
- [공개 사이트 휴대폰 검사 화면](../../images/viewer-editor/release-live-640x360.png). 검증용 프로젝트 화면이며 실제 기본 지도 화면을 대체하는 산출물은 아니다.

로컬 근거: `D:/build/pandolab-pages-product-2574f1e0.json`, `D:/build/pandolab-pages-product-2574f1e0-remote/pages-evidence.json`, `.superpowers/product-release-live.json`.

## 별도 CI 실패

[Windows 전체 지도 CI 39123723555](https://github.com/kimjeon-il/Pando/actions/runs/39123723555)는 앱 staging 자체를 완료한 뒤 고정된 객체·파일 수 기대값(597개 파일) 검사에서 실패했다. 이전 main `4d2cf482`의 [39111928606](https://github.com/kimjeon-il/Pando/actions/runs/39111928606)도 같은 단계와 같은 메시지로 실패했음을 로그로 확인했다. 이 기존 실패를 웹 배포 성공으로 덮거나 전체 CI 성공으로 표현하지 않는다. 이번에는 해당 별도 계약을 변경하지 않았다.

## 남은 검증 범위

Android 실제 양방향 회전·폴더블·멀티윈도·OS 파일 선택기 복귀와 Windows 네이티브 창 실행은 미검증이다. 새 APK/Windows 설치 파일을 만들거나 배포하지 않았다. 전체 테스트 묶음 및 전체 지도 편집 지연 시간 검증도 수행하지 않았다.

> 2026-10-21 정리 후속: 이 문서에서 언급한 완료된 작업의 일부 원시 증거는 외부로 옮겼다. 작성 당시의 결과는 변경하지 않았다. [브랜치별 원래 경로·SHA-256·보관 목록](/D:/dev/release-evidence/PandoLab/branch-cleanup-20261021/main-archive.json).
