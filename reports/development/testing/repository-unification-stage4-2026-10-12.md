# Web·App 저장소 통합 — 4단계 기록 (2026-10-12)

상태: 통합 구현 및 집중 검증 완료. 전체 기능 재검증은 5단계 범위이며, 아래의 기존 parity 출처 차이는 미해결이다.

## 이력과 파일

| 항목 | 고정 근거 |
| --- | --- |
| 통합 전 Web `main` | `a9921d880db30bc8a26c3b78a0286d38f6e0b0d5` |
| 통합 전 App `main` | `f124fdb42d8cf2de5d0294b2b26d37d992f3774f` |
| 정리한 App 이력의 `native/` 커밋 | `e17e7fa37720290cfbb557f838286bd1508eb9ac` |
| Web-only Pages 최초 커밋 | `982e29e0b5364a7cc8b884ddfb75a91c8ff1044d` |
| App 이력 병합 커밋 | `e03e2e1b43e1856b6630be8484277de995b36902` |

App 원본 저장소는 변경하지 않았다. 별도 미러에서 이전 `dist/windows-portable/` 경로만 과거 이력에서 제외하고 전체 App `main` 이력을 `native/`로 옮겼다. 병합 시 앱 파일 2,278개는 정리한 미러의 트리와 동일했고, `native/dist/windows-portable/`을 포함하는 통합 이력 커밋은 0개였다. 기존 Web 커밋은 재작성하지 않았으며, 병합 커밋의 첫 부모는 Web, 둘째 부모는 정리한 App 이력이다. 원본 저장소·감사 미러·상설 워크트리는 삭제하지 않았다.

웹은 루트, Qt 앱은 `native/`, 사람이 읽는 보고서는 `reports/`에 둔다. `native/reports/places/*.json`은 앱 검증과 빌드의 입력이므로 이동하지 않았다. 앱 원본에 있던 `.github/workflows`는 이력 보존용으로 `native/.github/workflows`에 남겨 실행되지 않는다. 현재 `main`·`work/*`용 앱 검증 6개와 App 고유의 North Schleswig 연구 흐름 5개를 루트 workflow로 연결했다. 양쪽에서 내용이 같던 연구 흐름 9개는 기존 루트 workflow를 사용한다. 과거 기능 브랜치 전용 흐름, 자동 커밋을 수행하는 Hydro 동기화, 포터블 릴리스 흐름은 자동 실행 대상으로 옮기지 않았다.

## Pages와 로컬 앱

Pages를 브랜치 루트 게시에서 GitHub Actions 게시로 전환했다. 웹 파일만 스테이징하는 스크립트는 Git blob을 검증하고, Windows 체크아웃의 LF/CRLF 차이는 내용이 동일할 때만 허용한다. 최초 웹 전용 게시 자료는 4,567개 파일·746,757,186바이트였고, [첫 Actions 실행](https://github.com/kimjeon-il/Pando/actions/runs/38217848289)이 성공했다. 실제 Pages의 `index.html`, 지형 및 수계 manifest는 스테이징한 파일과 바이트 단위로 일치했다. 이후 `native/`는 게시 자료에서 제외한다.

로컬 실행 스크립트 `native/Pandoeditor-local.bat`는 기본 빌드를 현재 상설 워크트리의 `build-native/Pandoeditor-ui`에 둔다. 포터블 디렉터리나 ZIP은 만들지 않는다. 이 위치에서 앱 실행 파일 212단계 빌드가 성공하고 `smoke` 실행이 종료 코드 0으로 끝났다.

## 검증과 남은 구분

- Pages 스테이징 테스트 5개, 변경 경로 분류 테스트 2개, 공식 Web·App 출처 검증을 포함한 앱 provenance 테스트 6개, 앱 지명 동일 커밋 비교 테스트 4개가 통과했다. 관련 Node 검사 전체 30개가 통과했다. 같은 커밋에서 지명 미러 24개·검수 배치 22개가 일치했다.
- 기존 앱 지명 스냅샷 검사 13개 중 원본 앱 커밋에서도 실패하던 2개는 테스트만 수정했다. 하나는 Windows CRLF에 따른 Git blob 해시 비교, 하나는 자체 자료의 1961-11-11 복원일과 모순된 1961-07-01 기대값이었다. 제품 자료와 규칙은 변경하지 않았고 수정 후 13개가 통과했다.
- 루트 workflow 61개를 YAML로 읽고, 옮긴 앱 workflow 11개의 실행 디렉터리와 트리거 경로를 점검했다.
- 승인된 Web 계약 핀 `f5040d34a1f596f9385a54c4e1e60c43360acfa4`는 자동 갱신하지 않았다. 통합 전 Web 기준 커밋에서도 현재 후보 46개 중 5개(`territorial-entities` 2개, library fixture 2개, timeline fixture 1개)의 SHA-256이 핀과 달랐다. 이 차이가 승인되기 전에는 공식 parity 회귀 판정이 통과하지 않는다.
- 전체 앱 CTest, 실제 Qt 입력, 전체 웹 UI·데이터 검증, Android 실기기, 포터블 패키징은 이 4단계에서 수행하지 않았다. 5단계 검증 또는 별도 명시적 요청이 필요하다.
