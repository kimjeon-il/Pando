# 객체 워크트리 main 동기화와 미커밋 작업 복원

> 보고서 ID: `OBJ-MAIN-SYNC-20261021` · 상태: `main-synchronized / local-wip-restored` · 지도 반영: `local-worktree-only` · 색인일: 2026-10-21
> 기준: 기존 `work/objects` HEAD `4f35c345e0707c44e383cca027e119207f93259c` → main `6fc982bfe1b3f13c0ce9988af0a73d1358f0be2b`

## 범위와 보관

사용자가 객체 브랜치부터 임시 보관·main 반영·복원을 승인했다.
미커밋 수정과 미추적 파일 56개의 원본 bytes를 별도 보관하고 SHA-256을 대조했다.
보고서·raw 실행 증거·predicate 비교 실험·Core 소스·WASM을 포함한다.

- 외부 보관: `D:/dev/release-evidence/PandoLab/objects-main-sync/4f35c345-20261021/`
- `manifest.json`: 원래 HEAD, 각 경로·크기·SHA-256
- `tracked.patch`: 추적 파일의 binary 포함 diff
- 유지한 stash: `226400edcf7c754fca6653c6980a60f5f9940e52`

`stash apply`로 복원했으며 `pop`/`drop`은 사용하지 않았다. 기존 단일 파일
생성기와 로더가 main에서 교체된 탓에 발생한 충돌은 양쪽 의미를 확인해 해결했다.
이번 작업은 기존 미커밋 기능의 main 병합·발행이나 UI 브랜치 동기화가 아니다.

## 복원 방식

- C++ 수명/지도 제공 기간 분리와 관련 모델·명령·테스트 수정은 보존했다.
  복원된 WASM source pin이 실제 Core 소스
  `7899aa82d40988da5093f622fc65d7f700ef5b07dd7165682c4eb37a97929296`과 일치한다.
- 폐기된 세계 단일 파일 생성기에 있던 수명 분리 수정을 현재
  `tools/builtin-world-compiler.mjs`로 옮겼다. 국가별 원본 수명은 원래 정밀도로
  유지하고, index의 선택 기준은 별도의 실제 geometry/parent 가용 구간이다.
  원본 수명만으로 역사 지도 공백을 채우지 않는다.
- 준비된 mesh의 시점 선택은 독립적인 수명 대신 geometry/parent 구간에서
  계산한다. 연 단위 수명이 날짜 문자열로 잘리는 실패를 피하면서 실제 형상
  변경 시점을 포함한다. 기존 캐시를 재사용해 국가 277개와 mesh 324개를 생성했다.
- 기존 단일 세계 파일·옛 manifest/coverage 및 폐기된 로더 테스트의 복원본은
  외부 보관의 `retired-restored/`로 옮겼다. 현재 실행 경로에 다시 추가하지 않는다.
  새 국가별 로더의 baseline 인계 검사에 기존 fresh document identity 검사를 유지했다.
- 기존 발행·수명 회귀 검사는 현재 국가별 입력/출력에 맞췄다. 현재 main의
  정적 편집 snapshot 계약은 유지한다. 원본 국가 수명은 국가별 기록과 객체의
  `metadata.historicalTimeline`에, 편집 인스턴스 수명은 프로젝트 기록에 속한다.
  과거 테스트가 두 개념을 동일시하던 부분을 현재 계약에 맞게 구분했다.
- HTML/빌드 메타데이터는 새 소스와 데이터에서 다시 생성한다. 과거 앱 실행
  증거의 빌드 ID나 source SHA를 새 검증 결과처럼 덮어쓰지 않는다.

## 실행한 검사와 한계

무시되는 worktree `build-native/objects-main-sync-*`에 raw 로그를 보존한다.

| 확인 | 결과/근거 |
| --- | --- |
| 수명·timeline 기록/resolver/편집, 국가 catalog/발행/loader | 관련 105개 통과, `focused-tests.log` |
| 기존 WASM과 복원된 Core 소스 | source pin 일치, 소스 재빌드 불필요 |
| 옮긴 생성기·테스트 및 browser/helper 코드 | 변경 범위 ESLint 통과 |
| 국가별 출력 | 277개, 기존 단일 프로젝트 없음 |
| 준비된 mesh | 324개, 172개 기존 mesh 재사용 |
| 국가 자료의 독립 수명 | 277개 모두 해당 원본 metadata 수명과 일치 |
| 기존 역사 결과 대조 | 월별 객체·형상 참조·상하위 관계·크림 귀속 일치, `baseline.log` |
| 최종 메타데이터 | 버전·manifest·import map 정합성 통과, `version.log` |
| 실제 브라우저 | 원본 수명과 자료 가용 구간의 분리, 편집 snapshot의 이름 변경 Undo/Redo·월 변경 후 출처 유지 2개 통과, `browser.log` |

위 로그는 모두 `build-native/objects-main-sync-` 접두사를 사용한다.
현재 국가 파일 277개의 해시/크기, Core/WASM·기존 실험·raw 증거 33개의
보존도 대조했다. 적용 충돌과 staged 경로는 모두 0개로 확인했다.
기존 [OBJ-LIFETIME-20261021](country-lifetime-2026-10-21.md)의 Windows WebView와
앱 실행 파일 검증은 당시 기준의 역사적 증거다. 이번에 전체 검사·앱 빌드·실제
Windows/Android WebView 실행을 반복하지 않았다. 새 main 계약에 맞춘 검사를
과거 앱 검증과 동일시하지 않는다.

수정은 미커밋 작업으로 남긴다. stash와 원본 보관본은 유지하며 main·UI 작업을
덮어쓰거나 원래 작업을 임의로 commit/push하지 않는다.
